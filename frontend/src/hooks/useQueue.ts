import { useSyncExternalStore } from "react";
import * as Q from "../lib/queue";
import type { QueueLevel, QueueMode, QueueState } from "../lib/queue";

const KEY = "chorus_queue";
let state: QueueState = load();
const listeners = new Set<() => void>();

function load(): QueueState {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as QueueState | null;
    if (v && Array.isArray(v.items) && typeof v.cursor === "number") return v;
  } catch { /* an unreadable queue is an empty one */ }
  return Q.EMPTY;
}

function set(next: QueueState): void {
  if (next === state) return;
  state = next;
  try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private window: the queue just is not kept across a reload */ }
  listeners.forEach((l) => l());
}

let note: string | null = null;
let noteTimer = 0;
/** A short message the bar shows for three seconds ("Added · 5th in queue"). */
export function announce(text: string): void {
  note = text;
  listeners.forEach((l) => l());
  clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => { note = null; listeners.forEach((l) => l()); }, 3000);
}
export const currentNote = (): string | null => note;

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The play queue of this browser session (survives a reload, gone with the tab). One shared store, so the bar, the panel and the lists agree. */
export function useQueue() {
  const q = useSyncExternalStore(subscribe, () => state);
  const message = useSyncExternalStore(subscribe, () => note);
  return {
    queue: q,
    message,
    start: (ids: readonly number[], defaults: { difficulty: QueueLevel; mode: QueueMode }, shuffle: boolean) => set(Q.start(ids, defaults, shuffle ? (Math.random() * 2 ** 32) >>> 0 : null)),
    add: (ids: readonly number[], defaults: { difficulty: QueueLevel; mode: QueueMode }) => {
      const base = Q.finished(state) ? Q.EMPTY : state; // a finished queue starts over with what is added
      const next = Q.add(base, ids, defaults);
      set(next);
      return { added: next.items.length - base.items.length };
    },
    set,
    advance: () => set(Q.advance(state)),
    clear: () => set(Q.EMPTY),
    reorder: (ids: number[]) => set(Q.reorderUpcoming(state, ids)),
    removeAt: (i: number) => set(Q.removeAt(state, i)),
    snapshot: () => state,
  };
}

export const queueDefaults = (difficulty: QueueLevel, mode: QueueMode = "choice") => ({ difficulty, mode });
