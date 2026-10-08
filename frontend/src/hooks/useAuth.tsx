import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, AUTH_REQUIRED } from "../services/api";
import type { AuthStateDto, UserDto } from "../services/api";

interface Auth {
  /** null while loading, and when nobody may use the server without signing in */
  user: UserDto | null;
  state: AuthStateDto | null;
  loading: boolean;
  /** The server could not tell who is asking (it is down, or older than this page): not the same as 'signed out'. */
  unreachable: string | null;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthStateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api.me());
      setUnreachable(null);
    } catch (e) {
      setState(null);
      setUnreachable(e instanceof Error ? e.message : "unknown");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // a request answered "sign in first" (guests were switched off meanwhile): show the sign-in page
    const on = () => setState((s) => (s ? { ...s, user: null, allow_guest: false } : s));
    window.addEventListener(AUTH_REQUIRED, on);
    return () => window.removeEventListener(AUTH_REQUIRED, on);
  }, [refresh]);

  const value = useMemo<Auth>(
    () => ({
      user: state?.user ?? null,
      state,
      loading,
      unreachable,
      signIn: async (u, p) => setState(await api.login(u, p)),
      signUp: async (u, p, d) => setState(await api.register(u, p, d)),
      signOut: async () => setState(await api.logout()),
      refresh,
    }),
    [state, loading, unreachable, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): Auth {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
