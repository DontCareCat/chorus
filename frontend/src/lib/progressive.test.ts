import { describe, expect, it } from "vitest";
import type { GameSummaryDto } from "../services/api";
import { progressiveLevel } from "./progressive";

const game = (over: Partial<GameSummaryDto>): GameSummaryDto => ({
  public_id: "x", song_id: 1, difficulty: "medium", mode: "choice", started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:05:00Z",
  score: 0, correct_count: 10, best_multiplier: 1, answered: 10, total: 10, ...over,
});

describe("progressiveLevel", () => {
  it("starts at Medium", () => expect(progressiveLevel([], 1, "choice")).toBe("medium"));
  it("goes one level up after a game at least 85% right", () => {
    expect(progressiveLevel([game({ correct_count: 9, total: 10 })], 1, "choice")).toBe("hard");
    expect(progressiveLevel([game({ difficulty: "easy", correct_count: 85, total: 100 })], 1, "choice")).toBe("medium");
  });
  it("stays where it was after a weaker game, and never lowers", () => {
    expect(progressiveLevel([game({ difficulty: "hard", correct_count: 2, total: 10 })], 1, "choice")).toBe("hard");
  });
  it("tops out at Expert", () => expect(progressiveLevel([game({ difficulty: "expert" })], 1, "choice")).toBe("expert"));
  it("uses the latest finished game of that song and mode only", () => {
    const games = [
      game({ difficulty: "easy", finished_at: "2026-01-01T00:00:00Z" }),
      game({ difficulty: "hard", correct_count: 1, finished_at: "2026-02-01T00:00:00Z" }),
      game({ difficulty: "expert", finished_at: "2026-03-01T00:00:00Z", mode: "typing" }),
      game({ difficulty: "expert", finished_at: "2026-04-01T00:00:00Z", song_id: 2 }),
      game({ difficulty: "easy", finished_at: null }),
    ];
    expect(progressiveLevel(games, 1, "choice")).toBe("hard");
  });
});
