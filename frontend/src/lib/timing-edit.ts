/** The rules of the lyrics timing editor (guide section 26). Only start times are edited, never text: a time list in, a time list out. */
export type Times = (number | null)[];

/** Two timed lines are never closer than this: a move that would pass a neighbour pushes it. */
export const MIN_GAP = 0.05;
/** The last time a line may have is this far before the end of the song. */
export const END_MARGIN = 0.1;
export const HISTORY_LIMIT = 100;

export const r2 = (t: number): number => Math.round(t * 100) / 100;
const clamp = (t: number, duration: number): number => r2(Math.min(Math.max(duration - END_MARGIN, 0), Math.max(0, t)));

export interface PlaceOptions { ripple: boolean; duration: number }
export interface Placed { times: Times; pushed: number }

/**
 * Give line `i` the time `to`. The order never changes: neighbours that would be passed are pushed just far enough to stay MIN_GAP away, in both
 * directions (`pushed` counts them). With `ripple` every later timed line moves by the same amount instead, and nothing else is pushed.
 */
export function place(times: Times, i: number, to: number, { ripple, duration }: PlaceOptions): Placed {
  const t = times.slice();
  const old = t[i];
  const nt = clamp(to, duration);
  if (ripple && old != null) {
    const d = nt - old;
    for (let j = i + 1; j < t.length; j++) if (t[j] != null) t[j] = clamp(t[j]! + d, duration);
    t[i] = nt;
    return { times: t, pushed: 0 };
  }
  t[i] = nt;
  let pushed = 0;
  let prev = nt;
  for (let j = i + 1; j < t.length; j++) {
    if (t[j] == null) continue;
    if (t[j]! < prev + MIN_GAP) { t[j] = r2(prev + MIN_GAP); pushed++; }
    prev = t[j]!;
  }
  let next = nt;
  for (let j = i - 1; j >= 0; j--) {
    if (t[j] == null) continue;
    if (t[j]! > next - MIN_GAP) { t[j] = r2(Math.max(0, next - MIN_GAP)); pushed++; }
    next = t[j]!;
  }
  return { times: t, pushed };
}

/** Set: the chosen line starts now, and the next line is chosen (the last line stays). */
export function setNow(times: Times, i: number, now: number, o: PlaceOptions): Placed & { next: number } {
  return { ...place(times, i, now, o), next: Math.min(i + 1, times.length - 1) };
}

/** Nudge by ±seconds; a line without a time starts from the playback time. */
export function nudge(times: Times, i: number, d: number, now: number, o: PlaceOptions): Placed {
  return place(times, i, (times[i] ?? now) + d, o);
}

/** Move every timed line by the same amount (kept inside the song). */
export function shiftAll(times: Times, d: number, duration: number): Times {
  return times.map((t) => (t == null ? null : clamp(t + d, duration)));
}

export const editedCount = (times: Times, original: Times): number => times.reduce<number>((n, t, i) => n + (t !== (original[i] ?? null) ? 1 : 0), 0);
export const timedCount = (times: Times): number => times.reduce<number>((n, t) => n + (t == null ? 0 : 1), 0);
export const sameTimes = (a: Times, b: Times): boolean => a.length === b.length && a.every((t, i) => t === b[i]);

/** Undo and redo for as long as the editor is open, up to HISTORY_LIMIT steps. */
export interface History { past: Times[]; future: Times[] }
export const emptyHistory: History = { past: [], future: [] };
export const record = (h: History, current: Times): History => ({ past: [...h.past, current].slice(-HISTORY_LIMIT), future: [] });
export function undo(h: History, current: Times): { history: History; times: Times } | null {
  const prev = h.past[h.past.length - 1];
  return prev ? { history: { past: h.past.slice(0, -1), future: [...h.future, current] }, times: prev } : null;
}
export function redo(h: History, current: Times): { history: History; times: Times } | null {
  const next = h.future[h.future.length - 1];
  return next ? { history: { past: [...h.past, current], future: h.future.slice(0, -1) }, times: next } : null;
}

/** `m:ss.cc`, or `--:--.--` without a time. */
export function fmt(t: number | null): string {
  if (t == null) return "--:--.--";
  const hundredths = Math.round(Math.max(0, t) * 100);
  const m = Math.floor(hundredths / 6000), rest = hundredths % 6000;
  return `${m}:${String(Math.floor(rest / 100)).padStart(2, "0")}.${String(rest % 100).padStart(2, "0")}`;
}
/** `m:ss.c` for the playback position. */
export function fmtNow(t: number): string {
  const tenths = Math.round(Math.max(0, t) * 10);
  const m = Math.floor(tenths / 600), rest = tenths % 600;
  return `${m}:${String(Math.floor(rest / 10)).padStart(2, "0")}.${rest % 10}`;
}
/** `1:02.40`, `62.4` or `62,4`; null when it is not a time. */
export function parseTime(v: string): number | null {
  const s = v.trim().replace(",", ".");
  const m = /^(\d+):(\d{1,2}(?:\.\d{1,3})?)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
}
/** "+0.40", "−1.20" (a real minus sign). */
export const signed = (d: number): string => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d).toFixed(2)}`;
export const signedSeconds = (d: number): string => `${signed(d)} s`;

/** What a row says about a line's change from the original, in words: "+0.40", "new" or "". */
export function changeOf(t: number | null, original: number | null): string {
  if (t == null || t === original) return "";
  return original == null ? "new" : signed(r2(t - original));
}
