import type { QuestionResult } from "./results";
import { getEarliestUnanswered } from "./synchronization";
import type { SyncQuestion } from "./synchronization";
import { SYNC_GRACE_PERIOD } from "./timing";

/** The player's progress strip (design guide section 23): a window onto the song with now fixed at the centre. Pure geometry, drawn by ProgressStrip. */
export const WINDOW_PHONE_S = 24;
export const WINDOW_WIDE_S = 60;
/** one loudness line every this many CSS px of strip width */
export const TICK_PX = 4;
/** the pointer has to move this far before a touch is a scrub (a tap does nothing) */
export const SCRUB_SLOP_PX = 6;
export const COAST_DECEL = 0.004; // px per ms²
export const COAST_MIN_SPEED = 0.05; // px per ms: slower than this the strip stops where it is
export const COAST_HISTORY_MS = 80;

export const mmss = (s: number) => {
  const t = Math.max(0, Math.floor(Number.isFinite(s) ? s : 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** The time left: `-m:ss`, `-0:00` at the end. */
export const timeLeft = (duration: number, now: number) => `-${mmss(Math.max(0, duration - now))}`;

/** Seconds per CSS px at the centre of the strip: the lens is x = half·sin(u·π/2), so the slope there is half·π/2 per half-window. */
export const secondsPerPx = (halfWindow: number, width: number) => halfWindow / ((width / 2) * (Math.PI / 2));

/** The lens: things shrink and fade with distance from the centre. `u` = Δt / half-window, -1..1. */
export function lens(u: number): { sx: number; d: number; h: number; o: number } {
  const sx = Math.sin((Math.max(-1, Math.min(1, u)) * Math.PI) / 2);
  const d = Math.abs(sx);
  return { sx, d, h: 1 - 0.6 * d * d, o: (1 - d * d * d) * (1 - 0.15 * d) };
}

export type LineResult = "open" | "correct" | "wrong" | "almost";

export interface StripLine {
  /** audio time of the lyric line */
  t: number;
  result: LineResult;
  /** the question being answered: the first open one */
  cap: boolean;
}

const questionResult = (answered: boolean, r: QuestionResult | undefined): LineResult => {
  if (!answered || !r) return "open";
  if (r.match !== undefined) return r.match === "full" ? "correct" : r.match === "partial" ? "almost" : "wrong";
  if (r.correct === undefined) return "open"; // given, the server has not judged it yet
  return r.correct ? "correct" : "wrong";
};

const SEVERITY: Record<LineResult, number> = { open: 4, wrong: 3, almost: 2, correct: 1 };

/** One line per lyric line with questions (they share a start time): open while any is open, otherwise the worst result (wrong > almost > correct). */
export function buildStripLines(questions: readonly SyncQuestion[], answered: ReadonlySet<number>, results: ReadonlyMap<number, QuestionResult>): StripLine[] {
  const groups = new Map<number, LineResult>();
  for (const q of questions) {
    const r = questionResult(answered.has(q.id), results.get(q.id));
    const prev = groups.get(q.startTime);
    groups.set(q.startTime, prev === undefined || SEVERITY[r] > SEVERITY[prev] ? r : prev);
  }
  const first = getEarliestUnanswered(questions, answered);
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([t, result]) => ({ t, result, cap: first !== null && first.startTime === t }));
}

/** Where a forward scrub stops: the first open question's end plus the grace, else the end of the song. */
export function scrubLimit(questions: readonly SyncQuestion[], answered: ReadonlySet<number>, duration: number, grace = SYNC_GRACE_PERIOD): number {
  const q = getEarliestUnanswered(questions, answered);
  return q ? Math.min(duration, q.endTime + grace) : duration;
}

export interface Peaks {
  /** 0..1 loudness, `perSecond` values per second */
  values: Float32Array;
  perSecond: number;
}

/** Loudness at time t (linear between values); undefined without data. */
export function loudAt(peaks: Peaks | null, t: number): number | undefined {
  if (!peaks || peaks.values.length === 0) return undefined;
  const x = Math.max(0, t) * peaks.perSecond;
  const i = Math.min(peaks.values.length - 1, Math.floor(x));
  const j = Math.min(peaks.values.length - 1, i + 1);
  const f = x - Math.floor(x);
  return peaks.values[i]! * (1 - f) + peaks.values[j]! * f;
}

export interface StripTick { x: number; y: number; h: number; o: number; played: boolean }
export interface StripMark { x: number; y: number; h: number; o: number; result: LineResult; cap: boolean }

export const UNIFORM_TICK = 0.35;

export interface StripInput {
  now: number;
  duration: number;
  width: number;
  height: number;
  halfWindow: number;
  peaks: Peaks | null;
  lines: readonly StripLine[];
  /** 0..1: how far the lines have moved from the even placeholder to the song's real loudness (they fade in when the data arrives) */
  blend?: number;
}

/** Everything one frame draws: loudness lines (1.5px wide, one per TICK_PX of strip width) and the question lines. */
export function layoutStrip({ now, duration, width, height, halfWindow, peaks, lines, blend = 1 }: StripInput): { ticks: StripTick[]; marks: StripMark[] } {
  const half = width / 2;
  const step = (2 * halfWindow) / (width / TICK_PX); // seconds between two loudness lines
  const first = Math.ceil((now - halfWindow) / step);
  const ticks: StripTick[] = [];
  for (let i = first; ; i++) {
    const t = i * step;
    if (t > now + halfWindow) break;
    if (t < 0 || t > duration) continue;
    const l = lens((t - now) / halfWindow);
    const loud = loudAt(peaks, t);
    const even = height * UNIFORM_TICK;
    const base = loud === undefined ? even : even + (4 + loud * (height * 0.7 - 4) - even) * blend;
    const h = Math.max(3, base * l.h);
    ticks.push({ x: half + half * l.sx - 0.75, y: (height - h) / 2, h, o: (t < now ? 0.32 : 0.2) * l.o, played: t < now });
  }
  const marks: StripMark[] = [];
  for (const line of lines) {
    const u = (line.t - now) / halfWindow;
    if (Math.abs(u) > 1) continue;
    const l = lens(u);
    const h = (height - 6) * l.h;
    marks.push({ x: half + half * l.sx, y: (height - h) / 2, h, o: l.o, result: line.result, cap: line.cap });
  }
  return { ticks, marks };
}

/**
 * Loudness values, `perSecond` per second, from decoded samples: the RMS of each slice (all channels together), scaled so the loudest slice is 1.
 * A little compression (square root) keeps quiet passages visible next to loud ones.
 */
export function peaksFromSamples(channels: readonly Float32Array[], sampleRate: number, perSecond = 10): Peaks {
  const len = channels[0]?.length ?? 0;
  const slice = Math.max(1, Math.round(sampleRate / perSecond));
  const n = Math.ceil(len / slice);
  const values = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const from = i * slice, to = Math.min(len, from + slice);
    let sum = 0;
    for (const ch of channels) for (let k = from; k < to; k++) sum += ch[k]! * ch[k]!;
    const rms = Math.sqrt(sum / Math.max(1, (to - from) * channels.length));
    values[i] = rms;
    if (rms > max) max = rms;
  }
  if (max > 0) for (let i = 0; i < n; i++) values[i] = Math.sqrt(values[i]! / max);
  return { values, perSecond };
}

/** Peaks as a short string for storage: two hex digits per value. */
export const packPeaks = (p: Peaks): string => Array.from(p.values, (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
export function unpackPeaks(s: string, perSecond = 10): Peaks | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(s)) return null;
  const values = new Float32Array(s.length / 2);
  for (let i = 0; i < values.length; i++) values[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16) / 255;
  return { values, perSecond };
}
