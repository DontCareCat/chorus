import type { GameSummaryDto } from "../services/api";

export type Level = "easy" | "medium" | "hard" | "expert";
const ORDER: readonly Level[] = ["easy", "medium", "hard", "expert"];
/** At least this share of right answers in a finished game raises the song's next level. */
export const STEP_UP_ACCURACY = 0.85;
/** Fewer than this share right, in {@link STEP_DOWN_GAMES} finished games in a row at the same level, lowers it. */
export const STEP_DOWN_ACCURACY = 0.25;
export const STEP_DOWN_GAMES = 2;
export const START_LEVEL: Level = "medium";

const isLevel = (v: string): v is Level => (ORDER as readonly string[]).includes(v);
const accuracyOf = (g: GameSummaryDto) => (g.total > 0 ? g.correct_count / g.total : 0);

/**
 * The level a song starts at in a queue with progressive difficulty: Medium the first time; afterwards the level of the
 * player's latest finished game of it (in that mode), one higher when it went at least 85% right, one lower when the last two
 * games at that level both went under 25% right (one bad game is not "consistently"). Stays within Easy..Expert.
 */
export function progressiveLevel(games: readonly GameSummaryDto[], songId: number, mode: string): Level {
  const played = games
    .filter((g) => g.song_id === songId && g.mode === mode && g.finished_at && isLevel(g.difficulty))
    .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""));
  const last = played[0];
  if (!last) return START_LEVEL;
  const at = ORDER.indexOf(last.difficulty as Level);
  if (accuracyOf(last) >= STEP_UP_ACCURACY) return ORDER[Math.min(ORDER.length - 1, at + 1)]!;
  let streak = 0;
  for (const g of played) {
    if (g.difficulty !== last.difficulty || accuracyOf(g) >= STEP_DOWN_ACCURACY) break;
    streak++;
  }
  return streak >= STEP_DOWN_GAMES ? ORDER[Math.max(0, at - 1)]! : (last.difficulty as Level);
}
