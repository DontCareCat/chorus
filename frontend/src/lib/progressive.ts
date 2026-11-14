import type { GameSummaryDto } from "../services/api";

export type Level = "easy" | "medium" | "hard" | "expert";
const ORDER: readonly Level[] = ["easy", "medium", "hard", "expert"];
/** More than this share right in a finished game raises the level by one. */
export const STEP_UP_ACCURACY = 0.9;
/** Fewer than this share right lowers it by one. */
export const STEP_DOWN_ACCURACY = 0.4;
export const START_LEVEL: Level = "medium";

const isLevel = (v: string): v is Level => (ORDER as readonly string[]).includes(v);
const accuracyOf = (g: GameSummaryDto) => (g.total > 0 ? g.correct_count / g.total : 0);

/** The level after a finished game: one up above 90% right, one down below 40% right, else the same. Stays within Easy..Expert. */
export function levelAfter(game: GameSummaryDto): Level {
  const at = ORDER.indexOf(game.difficulty as Level);
  const acc = accuracyOf(game);
  if (acc > STEP_UP_ACCURACY) return ORDER[Math.min(ORDER.length - 1, at + 1)]!;
  if (acc < STEP_DOWN_ACCURACY) return ORDER[Math.max(0, at - 1)]!;
  return ORDER[at]!;
}

const latest = (games: readonly GameSummaryDto[]) =>
  [...games].sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""))[0];

/**
 * The level a song should be played at when the difficulty follows the player (a queue with Progressive, and the recommendation in the
 * song's play options). The results are tracked per song: its latest finished game (in that mode) decides, one level up above 90% right,
 * one down below 40%. A song the player has not finished yet takes over where the player stands: the same step from their latest finished
 * game of any song in that mode, so a queue gets harder or easier from track to track. With no finished game at all: Medium.
 */
export function progressiveLevel(games: readonly GameSummaryDto[], songId: number, mode: string): Level {
  const finished = games.filter((g) => g.mode === mode && g.finished_at && isLevel(g.difficulty));
  const own = latest(finished.filter((g) => g.song_id === songId));
  if (own) return levelAfter(own);
  const any = latest(finished);
  return any ? levelAfter(any) : START_LEVEL;
}

/**
 * The level of the next song in a queue with Progressive: the queue adapts to how the player does in it. The game the queue started last
 * (`previousGameId`) decides: finished, its level steps up above 90% right and down below 40% (the same share-per-track rule); not finished
 * (the player skipped it), the level stays. The first song of a queue (no game started from it yet) takes the recommendation from the history.
 */
export function queueLevel(games: readonly GameSummaryDto[], previousGameId: string | null | undefined, songId: number, mode: string): Level {
  const prev = previousGameId ? games.find((g) => g.public_id === previousGameId && isLevel(g.difficulty)) : undefined;
  if (prev) return prev.finished_at ? levelAfter(prev) : (prev.difficulty as Level);
  return progressiveLevel(games, songId, mode);
}
