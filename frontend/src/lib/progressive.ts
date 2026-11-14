import type { GameSummaryDto } from "../services/api";

export type Level = "easy" | "medium" | "hard" | "expert";
const ORDER: readonly Level[] = ["easy", "medium", "hard", "expert"];
/** A finished game with more than this share right counts towards stepping up. */
export const STEP_UP_ACCURACY = 0.9;
/** A finished game with less than this share right counts towards stepping down. */
export const STEP_DOWN_ACCURACY = 0.4;
/** Finished games in a row above STEP_UP_ACCURACY needed to raise the level by one. */
export const STEP_UP_RUN = 4;
/** Finished games in a row below STEP_DOWN_ACCURACY needed to lower it by one. */
export const STEP_DOWN_RUN = 2;
export const START_LEVEL: Level = "medium";

const isLevel = (v: string): v is Level => (ORDER as readonly string[]).includes(v);
const accuracyOf = (g: GameSummaryDto) => (g.total > 0 ? g.correct_count / g.total : 0);
const bandOf = (g: GameSummaryDto): "high" | "low" | "mid" => {
  const acc = accuracyOf(g);
  return acc > STEP_UP_ACCURACY ? "high" : acc < STEP_DOWN_ACCURACY ? "low" : "mid";
};

/**
 * The level the player stands at after `finished` (finished games, NEWEST FIRST): the level of the newest game, moved by one when the run
 * of games ending with it earns a step. The run is the newest games in a row at that same level in the same band: 4 with more than 90% right
 * step up, 2 with less than 40% right step down; a game between (40-90%) or at another level ends the run, so the 4 and 2 must be fresh after
 * every step (the games after a step are played at the new level). Stays within Easy..Expert.
 */
export function levelAfter(finished: readonly GameSummaryDto[]): Level {
  const newest = finished[0];
  if (!newest || !isLevel(newest.difficulty)) return START_LEVEL;
  const at = ORDER.indexOf(newest.difficulty);
  const band = bandOf(newest);
  let run = 0;
  while (run < finished.length && finished[run]!.difficulty === newest.difficulty && bandOf(finished[run]!) === band) run++;
  if (band === "high" && run >= STEP_UP_RUN) return ORDER[Math.min(ORDER.length - 1, at + 1)]!;
  if (band === "low" && run >= STEP_DOWN_RUN) return ORDER[Math.max(0, at - 1)]!;
  return ORDER[at]!;
}

const newestFirst = (games: readonly GameSummaryDto[]) =>
  [...games].sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""));

/**
 * The level the player should play at when the difficulty follows them (the recommendation in a song's play options, and the first song of
 * a queue with Progressive): the streak rule (`levelAfter`) over the player's finished games in that mode, whichever songs they were. With no finished game: Medium.
 */
export function progressiveLevel(games: readonly GameSummaryDto[], mode: string): Level {
  return levelAfter(newestFirst(games.filter((g) => g.mode === mode && g.finished_at && isLevel(g.difficulty))));
}

/**
 * The level of the next song in a queue with Progressive: the queue adapts to how the player does in it. The level is the one of the game the
 * queue started last (`run`, the games it started, oldest first), moved by the streak rule over the queue's own finished games: 4 in a row
 * above 90% right step up, 2 in a row below 40% step down. Tracks that were skipped (never finished) neither count nor break a run. The first
 * song of a queue (nothing started yet) takes `progressiveLevel` from the history.
 */
export function queueLevel(games: readonly GameSummaryDto[], run: readonly string[] | undefined, mode: string): Level {
  const byId = new Map(games.map((g) => [g.public_id, g]));
  const started = (run ?? []).map((id) => byId.get(id)).filter((g): g is GameSummaryDto => !!g && isLevel(g.difficulty));
  const last = started[started.length - 1];
  if (!last) return progressiveLevel(games, mode);
  const finished = started.filter((g) => g.finished_at).reverse();
  // the run is judged only while the newest finished track is at the level the queue is at now (a skipped last track keeps its level)
  return finished[0]?.difficulty === last.difficulty ? levelAfter(finished) : (last.difficulty as Level);
}
