import { getEarliestUnanswered } from "./synchronization";
import type { SyncQuestion } from "./synchronization";
import { SYNC_GRACE_PERIOD } from "./timing";

export interface RunwayTick {
  /** The first open question of this line (or its first question when all are answered): what a click focuses. */
  id: number;
  pct: number;
  /** All questions of the line are answered. */
  answered: boolean;
  /** How many questions the line has. */
  count: number;
}

export interface Runway {
  playheadPct: number;
  ticks: RunwayTick[];
  /** Where the audio will stop and wait (earliest unanswered end + grace); null if nothing blocks. */
  deadlinePct: number | null;
  /** Seconds until the deadline (can be negative while recovering); null if nothing blocks. */
  slack: number | null;
  /** Seconds the earliest unanswered question is still ahead of the playhead (0 if the audio is already past it). */
  ahead: number | null;
  blockingId: number | null;
}

/** One tick per lyric line (questions on the same line share their start time), not one per question. */
function tickGroups(questions: readonly SyncQuestion[], answered: ReadonlySet<number>, duration: number): RunwayTick[] {
  const groups = new Map<number, SyncQuestion[]>();
  for (const q of questions) groups.set(q.startTime, [...(groups.get(q.startTime) ?? []), q]);
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, qs]) => {
      const open = qs.filter((q) => !answered.has(q.id)).sort((a, b) => a.sequence - b.sequence);
      return { id: (open[0] ?? qs[0]!).id, pct: pct(start, duration), answered: open.length === 0, count: qs.length };
    });
}

const pct = (t: number, duration: number) => (duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0);

/** Geometry and numbers for the runway strip. Pure, so it is tested without a DOM. */
export function computeRunway(input: {
  duration: number;
  currentTime: number;
  questions: readonly SyncQuestion[];
  answered: ReadonlySet<number>;
}): Runway {
  const { duration, currentTime, questions, answered } = input;
  const blocking = getEarliestUnanswered(questions, answered);
  const deadline = blocking ? blocking.endTime + SYNC_GRACE_PERIOD : null;
  return {
    playheadPct: pct(currentTime, duration),
    ticks: tickGroups(questions, answered, duration),
    deadlinePct: deadline === null ? null : pct(deadline, duration),
    slack: deadline === null ? null : deadline - currentTime,
    ahead: blocking ? Math.max(0, blocking.startTime - currentTime) : null,
    blockingId: blocking?.id ?? null,
  };
}
