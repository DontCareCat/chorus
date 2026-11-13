import { SYNC_GRACE_PERIOD } from "./timing";

/** The minimum a question needs for synchronization. All times are audio times (offset already applied). */
export interface SyncQuestion {
  id: number;
  sequence: number;
  startTime: number;
  endTime: number;
  /** Start of the previous lyric line; for the first line, its own start. Supplied by the backend. */
  recoveryTime: number;
}

/** The earliest unanswered question blocks playback — never "the most recently shown" one. */
export function getEarliestUnanswered<Q extends SyncQuestion>(
  questions: readonly Q[],
  answered: ReadonlySet<number>,
): Q | null {
  let best: Q | null = null;
  for (const q of questions) {
    if (answered.has(q.id)) continue;
    if (best === null || q.startTime < best.startTime || (q.startTime === best.startTime && q.sequence < best.sequence)) {
      best = q;
    }
  }
  return best;
}

/** Strict '>' : exactly 3 s ahead is still acceptable. */
export function isOverdue(currentTime: number, q: SyncQuestion, grace: number = SYNC_GRACE_PERIOD): boolean {
  return currentTime > q.endTime + grace;
}

/** The audio never goes back further than this from the open question's line (a long gap between two lines would rewind far too much). */
export const MAX_RECOVERY_REWIND = 5;

/** Where the game goes back to when the player fails to answer in time: the previous lyric line's start (supplied by the backend), but not more than 5 s before the question's line; the question's own start for the first line. */
export function getRecoveryPosition(q: SyncQuestion): number {
  if (!Number.isFinite(q.recoveryTime)) return q.startTime;
  return Math.max(q.recoveryTime, q.startTime - MAX_RECOVERY_REWIND);
}

export interface SeekLimit {
  target: number;
  /** The request went past the open question and was limited. */
  clamped: boolean;
}

/**
 * Where a user's seek may land. An unanswered question cannot be skipped: anything past its deadline (end + grace)
 * is limited to the question's own line: its start if the audio is still before it, otherwise where the audio
 * already is. Seeking backwards, or when nothing is open, is never limited.
 */
export function limitSeek(input: {
  requested: number;
  current: number;
  questions: readonly SyncQuestion[];
  answered: ReadonlySet<number>;
  grace?: number;
}): SeekLimit {
  const q = getEarliestUnanswered(input.questions, input.answered);
  if (q === null) return { target: input.requested, clamped: false };
  const limit = q.endTime + (input.grace ?? SYNC_GRACE_PERIOD);
  if (input.requested <= limit) return { target: input.requested, clamped: false };
  return { target: Math.min(limit, Math.max(q.startTime, input.current)), clamped: true };
}

export type SyncDecision =
  | { kind: "ok" }
  | { kind: "recover"; question: SyncQuestion; target: number };

export interface SyncInput {
  currentTime: number;
  /** The engine reached the end of the audio. The grace rule can never fire after that (e.g. duration < end + 3). */
  ended?: boolean;
  questions: readonly SyncQuestion[];
  answered: ReadonlySet<number>;
  grace?: number;
}

/** Pure synchronization check; the caller (PlaybackController) makes recovery idempotent. */
export function updateSynchronization(input: SyncInput): SyncDecision {
  const q = getEarliestUnanswered(input.questions, input.answered);
  if (q === null) return { kind: "ok" };
  if (input.ended || isOverdue(input.currentTime, q, input.grace)) {
    return { kind: "recover", question: q, target: getRecoveryPosition(q) };
  }
  return { kind: "ok" };
}
