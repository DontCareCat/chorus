import type { GameSummaryDto } from "../services/api";

export type Level = "easy" | "medium" | "hard" | "expert";
const ORDER: readonly Level[] = ["easy", "medium", "hard", "expert"];
/** At least this share of right answers in a finished game raises the song's next level. */
export const STEP_UP_ACCURACY = 0.85;
export const START_LEVEL: Level = "medium";

const isLevel = (v: string): v is Level => (ORDER as readonly string[]).includes(v);

/**
 * The level a song starts at in a queue with progressive difficulty: Medium the first time; afterwards the level of the
 * player's latest finished game of it (in that mode), one higher when it went at least 85% right. Never lowers, tops out at Expert.
 */
export function progressiveLevel(games: readonly GameSummaryDto[], songId: number, mode: string): Level {
  const last = games
    .filter((g) => g.song_id === songId && g.mode === mode && g.finished_at && isLevel(g.difficulty))
    .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""))[0];
  if (!last) return START_LEVEL;
  const level = last.difficulty as Level;
  const accuracy = last.total > 0 ? last.correct_count / last.total : 0;
  return accuracy >= STEP_UP_ACCURACY ? ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(level) + 1)]! : level;
}
