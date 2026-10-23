import { moveItem } from "./reorder";

export type QueueLevel = "progressive" | "easy" | "medium" | "hard" | "expert";
export type QueueMode = "choice" | "typing";

export interface QueueItem { songId: number; difficulty: QueueLevel; mode: QueueMode }
/** `cursor` is the index of the song that comes next; everything before it has been started or skipped. */
export interface QueueState { items: QueueItem[]; cursor: number }

export const EMPTY: QueueState = { items: [], cursor: 0 };

export function add(q: QueueState, songIds: readonly number[], defaults: { difficulty: QueueLevel; mode: QueueMode }): QueueState {
  const have = new Set(q.items.map((i) => i.songId));
  const fresh = [...new Set(songIds)].filter((id) => !have.has(id)).map((songId) => ({ songId, ...defaults }));
  return fresh.length ? { ...q, items: [...q.items, ...fresh] } : q;
}

/** Fisher-Yates with a seedable generator (mulberry32), so a test can replay the order. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

export function start(songIds: readonly number[], defaults: { difficulty: QueueLevel; mode: QueueMode }, seed: number | null): QueueState {
  const ids = seed === null ? [...songIds] : shuffled(songIds, seed);
  return { items: ids.map((songId) => ({ songId, ...defaults })), cursor: 0 };
}

export const next = (q: QueueState): QueueItem | null => q.items[q.cursor] ?? null;
export const finished = (q: QueueState): boolean => q.items.length > 0 && q.cursor >= q.items.length;
/** The queue moves on: the next song was started or skipped. */
export const advance = (q: QueueState): QueueState => (q.cursor < q.items.length ? { ...q, cursor: q.cursor + 1 } : q);

/** Remove the song at `index`; the cursor keeps pointing at the same upcoming song. */
export function removeAt(q: QueueState, index: number): QueueState {
  if (index < 0 || index >= q.items.length) return q;
  return { items: q.items.filter((_, i) => i !== index), cursor: index < q.cursor ? q.cursor - 1 : q.cursor };
}

/** Reorder the waiting songs only (those from the cursor on); `ids` is the new order of those. */
export function reorderUpcoming(q: QueueState, ids: readonly number[]): QueueState {
  const done = q.items.slice(0, q.cursor);
  const byId = new Map(q.items.slice(q.cursor).map((i) => [i.songId, i]));
  const upcoming = ids.map((id) => byId.get(id)).filter((i): i is QueueItem => !!i);
  return upcoming.length === byId.size ? { ...q, items: [...done, ...upcoming] } : q;
}

export function moveToTop(q: QueueState, songId: number): QueueState {
  const at = q.items.findIndex((i, idx) => idx >= q.cursor && i.songId === songId);
  return at < 0 ? q : { ...q, items: [...q.items.slice(0, q.cursor), ...moveItem(q.items.slice(q.cursor), at - q.cursor, 0)] };
}

export function setItem(q: QueueState, songId: number, patch: Partial<Pick<QueueItem, "difficulty" | "mode">>): QueueState {
  return { ...q, items: q.items.map((i) => (i.songId === songId ? { ...i, ...patch } : i)) };
}

/** Change every waiting song at once (the queue menu's "for all"). */
export function setAllUpcoming(q: QueueState, patch: Partial<Pick<QueueItem, "difficulty" | "mode">>): QueueState {
  return { ...q, items: q.items.map((i, idx) => (idx >= q.cursor ? { ...i, ...patch } : i)) };
}

/** The value all waiting songs share (for the tick in the "for all" submenu), or null when they differ. */
export function shared<K extends "difficulty" | "mode">(q: QueueState, key: K): QueueItem[K] | null {
  const up = q.items.slice(q.cursor);
  return up.length > 0 && up.every((i) => i[key] === up[0]![key]) ? up[0]![key] : null;
}

export const upcoming = (q: QueueState): QueueItem[] => q.items.slice(q.cursor);
