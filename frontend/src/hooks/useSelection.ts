import { useCallback, useState } from "react";

export interface Selection {
  picked: ReadonlySet<number>;
  /** the list is in select mode: from the first tick until it is cancelled (unticking the last song does not end it) */
  active: boolean;
  has: (id: number) => boolean;
  toggle: (id: number) => void;
  add: (id: number) => void;
  selectAll: (ids: readonly number[]) => void;
  clear: () => void;
  /** forget ids that are no longer in the list (removed, or filtered away by a new search) */
  keepOnly: (ids: ReadonlySet<number>) => void;
}

/** The ticked songs of the library; the page is in select mode from the first tick until the person cancels it. */
export function useSelection(): Selection {
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [on, setOn] = useState(false);
  const toggle = useCallback((id: number) => (setOn(true), setPicked((p) => { const n = new Set(p); if (!n.delete(id)) n.add(id); return n; })), []);
  const add = useCallback((id: number) => (setOn(true), setPicked((p) => (p.has(id) ? p : new Set(p).add(id)))), []);
  const selectAll = useCallback((ids: readonly number[]) => (setOn(true), setPicked(new Set(ids))), []);
  const clear = useCallback(() => (setOn(false), setPicked((p) => (p.size === 0 ? p : new Set()))), []);
  const keepOnly = useCallback((ids: ReadonlySet<number>) => setPicked((p) => {
    if ([...p].every((id) => ids.has(id))) return p;
    return new Set([...p].filter((id) => ids.has(id)));
  }), []);
  return { picked, active: on, has: (id) => picked.has(id), toggle, add, selectAll, clear, keepOnly };
}
