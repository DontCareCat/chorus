import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../services/api";

/** One page of a long list: the rows and how many there are in all (plus whatever else the page answers with). */
export interface Paged<R> {
  total: number;
  items: R[];
}

export interface PagedList<T extends Paged<R>, R> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** the next page is on its way */
  loadingMore: boolean;
  hasMore: boolean;
  /** fetch the next page and add it at the end */
  loadMore: () => void;
  /** fetch again everything loaded so far (after a change, or while translations arrive) */
  reload: () => void;
}

export const PAGE = 100;
export const CHUNK = 500; // the most rows one request may ask for

/**
 * A long list loaded a page at a time (the Dictionary page's infinite scroll). A change of `deps` starts again from the first page;
 * `loadMore` fetches only the next page; `reload` fetches the rows loaded so far again, in chunks the server accepts. Stale answers
 * are ignored.
 */
export function usePagedList<T extends Paged<R>, R extends { id: number }>(
  fetch: (offset: number, limit: number) => Promise<T>, deps: unknown[], page = PAGE,
): PagedList<T, R> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);
  const current = useRef<T | null>(null);
  current.current = data;
  const busy = useRef(false); // a loadMore is running: a second one waits for it
  const fresh = useRef(true); // the first page (or a reload) is on its way: the rows on screen may belong to the old filters
  fresh.current = loading;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const get = useCallback((offset: number, limit: number) => fetch(offset, limit), deps); // a new one for new deps: starts from page one
  const getRef = useRef(get);
  getRef.current = get;

  const fail = (e: unknown) => setError(e instanceof ApiError ? e : new ApiError("unknown", String(e), 0));

  /** rows 0..count again, CHUNK at a time; the last answer's totals win */
  const range = useCallback(async (count: number): Promise<T> => {
    let out: T | null = null;
    const rows: R[] = [];
    for (let offset = 0; offset < Math.max(count, 1); offset += CHUNK) {
      const part = await getRef.current(offset, Math.min(CHUNK, Math.max(count, 1) - offset));
      rows.push(...part.items);
      out = part;
      if (offset + part.items.length >= part.total) break;
    }
    return { ...(out as T), items: rows };
  }, []);

  useEffect(() => {
    const mine = ++seq.current;
    busy.current = false;
    setLoading(true);
    setLoadingMore(false);
    get(0, page).then(
      (d) => mine === seq.current && (setData(d), setError(null), setLoading(false)),
      (e: unknown) => mine === seq.current && (fail(e), setLoading(false)),
    );
  }, [get, page]);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    busy.current = false;
    setLoadingMore(false);
    setLoading(true);
    range(Math.max(page, current.current?.items.length ?? 0)).then(
      (d) => mine === seq.current && (setData(d), setError(null), setLoading(false)),
      (e: unknown) => mine === seq.current && (fail(e), setLoading(false)),
    );
  }, [range, page]);

  const loadMore = useCallback(() => {
    const now = current.current;
    if (!now || busy.current || fresh.current || now.items.length >= now.total) return;
    const mine = seq.current;
    busy.current = true;
    setLoadingMore(true);
    getRef.current(now.items.length, page).then(
      (d) => {
        if (mine !== seq.current) return;
        busy.current = false;
        setLoadingMore(false);
        setData((prev) => {
          if (!prev) return d;
          const seen = new Set(prev.items.map((r) => r.id)); // a word added meanwhile shifts the pages: never show a row twice
          return { ...d, items: [...prev.items, ...d.items.filter((r) => !seen.has(r.id))] };
        });
      },
      (e: unknown) => {
        if (mine !== seq.current) return;
        busy.current = false;
        setLoadingMore(false);
        fail(e);
      },
    );
  }, [page]);

  return { data, error, loading, loadingMore, hasMore: !!data && data.items.length < data.total, loadMore, reload };
}

/** Calls `onVisible` while the element is on screen (or within `margin` of it): the end-of-list marker of an infinite scroll. */
export function useNearEnd(onVisible: () => void, enabled: boolean, margin = "0px 0px 400px 0px") {
  const [el, setEl] = useState<Element | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [el, margin]);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  // still in view after a page arrived (a tall screen, short rows): ask for the next one too
  useEffect(() => { if (near && enabled) cb.current(); });
  return setEl;
}
