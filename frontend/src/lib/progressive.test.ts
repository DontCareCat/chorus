import { describe, expect, it } from "vitest";
import type { GameSummaryDto } from "../services/api";
import { levelAfter, progressiveLevel, queueLevel } from "./progressive";

const game = (over: Partial<GameSummaryDto>): GameSummaryDto => ({
  public_id: "x", song_id: 1, difficulty: "medium", mode: "choice", started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:05:00Z",
  score: 0, correct_count: 10, best_multiplier: 1, answered: 10, total: 10, ...over,
});
const right = (n: number, over: Partial<GameSummaryDto> = {}) => game({ correct_count: n, total: 100, ...over });
/** games, newest first, as levelAfter takes them */
const run = (shares: number[], over: Partial<GameSummaryDto> = {}) => shares.map((n) => right(n, over));

describe("levelAfter (the streak rule)", () => {
  it("3 games in a row above 90% do not step up, 4 do (90% exactly is not above)", () => {
    expect(levelAfter(run([95, 95, 95]))).toBe("medium");
    expect(levelAfter(run([95, 95, 95, 95]))).toBe("hard");
    expect(levelAfter(run([95, 95, 95, 90]))).toBe("medium");
    expect(levelAfter(run([100, 100, 100, 100, 100], { difficulty: "easy" }))).toBe("medium");
  });
  it("1 game below 40% does not step down, 2 in a row do (40% exactly is not below)", () => {
    expect(levelAfter(run([10]))).toBe("medium");
    expect(levelAfter(run([10, 10]))).toBe("easy");
    expect(levelAfter(run([39, 40]))).toBe("medium");
    expect(levelAfter(run([0, 0], { difficulty: "expert" }))).toBe("hard");
  });
  it("a game between 40% and 90% resets both runs", () => {
    expect(levelAfter(run([95, 95, 95, 60, 95, 95, 95, 95]))).toBe("medium"); // newest first: only 3 in the new run... see below
    expect(levelAfter(run([95, 95, 95, 95, 60, 95]))).toBe("hard");
    expect(levelAfter(run([10, 60, 10]))).toBe("medium");
    expect(levelAfter(run([10, 10, 60], { difficulty: "hard" }))).toBe("medium");
  });
  it("a high game ends a low run and the other way round", () => {
    expect(levelAfter(run([10, 95, 10]))).toBe("medium");
    expect(levelAfter(run([95, 10, 95, 95, 95]))).toBe("medium");
  });
  it("games at another level end the run: after a step the next step needs a fresh run", () => {
    const afterStep = [...run([95, 95, 95], { difficulty: "hard" }), ...run([95, 95, 95, 95], { difficulty: "medium" })];
    expect(levelAfter(afterStep)).toBe("hard");
    expect(levelAfter([...run([95, 95, 95, 95], { difficulty: "hard" }), ...run([95], { difficulty: "medium" })])).toBe("expert");
  });
  it("stays within Easy..Expert", () => {
    expect(levelAfter(run([0, 0], { difficulty: "easy" }))).toBe("easy");
    expect(levelAfter(run([100, 100, 100, 100], { difficulty: "expert" }))).toBe("expert");
  });
  it("counts a game with no questions as nothing right; no game at all is Medium", () => {
    expect(levelAfter([game({ correct_count: 0, total: 0, difficulty: "hard" }), game({ correct_count: 0, total: 0, difficulty: "hard" })])).toBe("medium");
    expect(levelAfter([])).toBe("medium");
  });
});

describe("progressiveLevel", () => {
  const at = (n: number, day: number, over: Partial<GameSummaryDto> = {}) => right(n, { finished_at: `2026-01-${String(day).padStart(2, "0")}T00:00:00Z`, ...over });
  it("starts at Medium when nothing was finished", () => {
    expect(progressiveLevel([], "choice")).toBe("medium");
    expect(progressiveLevel([game({ finished_at: null })], "choice")).toBe("medium");
  });
  it("applies the streak rule to the player's finished games whichever songs they were, in time order", () => {
    const games = [1, 2, 3, 4].map((d) => at(95, d, { song_id: d }));
    expect(progressiveLevel(games, "choice")).toBe("hard");
    expect(progressiveLevel(games.slice(0, 3), "choice")).toBe("medium");
    expect(progressiveLevel([...games, at(60, 5)], "choice")).toBe("medium");
    expect(progressiveLevel([at(10, 1), at(10, 2)], "choice")).toBe("easy");
  });
  it("unfinished games do not count, and each mode is tracked apart", () => {
    const games = [1, 2, 3, 4].map((d) => at(95, d, { mode: "typing" }));
    expect(progressiveLevel([...games, at(0, 9, { finished_at: null, mode: "typing" })], "typing")).toBe("hard");
    expect(progressiveLevel(games, "choice")).toBe("medium");
  });
});

describe("queueLevel (progressive difficulty within the current queue)", () => {
  const g = (id: string, n: number, level: GameSummaryDto["difficulty"], day: number, over: Partial<GameSummaryDto> = {}) =>
    right(n, { public_id: id, difficulty: level, finished_at: `2026-02-${String(day).padStart(2, "0")}T00:00:00Z`, ...over });
  it("the first song of a queue takes the recommendation from the history", () => {
    expect(queueLevel([], undefined, "choice")).toBe("medium");
    expect(queueLevel([], [], "choice")).toBe("medium");
    const hist = [1, 2, 3, 4].map((d) => right(95, { public_id: `h${d}`, finished_at: `2026-01-0${d}T00:00:00Z` }));
    expect(queueLevel(hist, undefined, "choice")).toBe("hard");
  });
  it("one good or one bad track changes nothing", () => {
    expect(queueLevel([g("a", 95, "medium", 1)], ["a"], "choice")).toBe("medium");
    expect(queueLevel([g("a", 5, "medium", 1)], ["a"], "choice")).toBe("medium");
  });
  it("4 finished tracks in a row above 90% step up; 3 do not", () => {
    const games = ["a", "b", "c", "d"].map((id, i) => g(id, 95, "medium", i + 1));
    expect(queueLevel(games, ["a", "b", "c"], "choice")).toBe("medium");
    expect(queueLevel(games, ["a", "b", "c", "d"], "choice")).toBe("hard");
  });
  it("2 finished tracks in a row below 40% step down", () => {
    const games = [g("a", 10, "hard", 1), g("b", 10, "hard", 2)];
    expect(queueLevel(games, ["a"], "choice")).toBe("hard");
    expect(queueLevel(games, ["a", "b"], "choice")).toBe("medium");
  });
  it("a track in between resets the runs; after a step the next step needs a fresh run", () => {
    const mixed = [g("a", 95, "medium", 1), g("b", 95, "medium", 2), g("c", 60, "medium", 3), g("d", 95, "medium", 4), g("e", 95, "medium", 5)];
    expect(queueLevel(mixed, ["a", "b", "c", "d", "e"], "choice")).toBe("medium");
    const stepped = [g("a", 95, "medium", 1), g("b", 95, "medium", 2), g("c", 95, "medium", 3), g("d", 95, "medium", 4), g("e", 95, "hard", 5)];
    expect(queueLevel(stepped, ["a", "b", "c", "d", "e"], "choice")).toBe("hard"); // e is the first of a new run at Hard
  });
  it("skipped tracks neither count nor break a run, and a skipped last track keeps its level", () => {
    const games = [g("a", 95, "medium", 1), g("b", 95, "medium", 2), g("s", 0, "medium", 3, { finished_at: null }), g("c", 95, "medium", 4), g("d", 95, "medium", 5)];
    expect(queueLevel(games, ["a", "b", "s", "c", "d"], "choice")).toBe("hard");
    expect(queueLevel(games, ["a", "b", "s"], "choice")).toBe("medium");
    expect(queueLevel([g("x", 0, "hard", 1, { finished_at: null })], ["x"], "choice")).toBe("hard");
  });
  it("only the queue's own games count, not older games of the same songs; unknown ids fall back to the history", () => {
    const old = right(100, { public_id: "old", difficulty: "expert", finished_at: "2020-01-01T00:00:00Z" });
    expect(queueLevel([old, g("a", 50, "easy", 1)], ["a"], "choice")).toBe("easy");
    expect(queueLevel([], ["gone"], "choice")).toBe("medium");
  });
  it("stays within Easy..Expert", () => {
    const games = ["a", "b", "c", "d"].map((id, i) => g(id, 100, "expert", i + 1));
    expect(queueLevel(games, ["a", "b", "c", "d"], "choice")).toBe("expert");
  });
});
