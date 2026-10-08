import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../services/api";

export interface Async<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  setData: (d: T | null) => void;
}

/** Load once (and on `reload`/dependency change); ignores stale responses. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    run().then(
      (d) => mine === seq.current && (setData(d), setError(null), setLoading(false)),
      (e: unknown) => mine === seq.current && (setError(e instanceof ApiError ? e : new ApiError("unknown", String(e), 0)), setLoading(false)),
    );
  }, [run, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1), setData };
}
