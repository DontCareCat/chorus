import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, AUTH_REQUIRED } from "../services/api";
import type { AuthStateDto, UserDto } from "../services/api";

interface Auth {
  /** null while loading, and when nobody may use the server without signing in */
  user: UserDto | null;
  state: AuthStateDto | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthStateDto | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setState(await api.me());
    } catch {
      setState(null);
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
      signIn: async (u, p) => setState(await api.login(u, p)),
      signUp: async (u, p, d) => setState(await api.register(u, p, d)),
      signOut: async () => setState(await api.logout()),
      refresh,
    }),
    [state, loading, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): Auth {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
