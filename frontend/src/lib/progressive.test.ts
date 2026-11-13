import { describe, expect, it } from "vitest";
import type { GameSummaryDto } from "../services/api";
import { levelAfter, progressiveLevel } from "./progressive";

const game = (over: Partial<GameSummaryDto>): GameSummaryDto => ({
  public_id: "x", song_id: 1, difficulty: "medium", mode: "choice", started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:05:00Z",
  score: 0, correct_count: 10, best_multiplier: 1, answered: 10, total: 10, ...over,
});
const right = (n: number, over: Partial<GameSummaryDto> = {}) => game({ correct_count: n, total: 100, ...over });

describe("levelAfter", () => {
  it("goes up only above 90% right (90% exactly stays)", () => {
    expect(levelAfter(right(91))).toBe("hard");
    expect(levelAfter(right(90))).toBe("medium");
    expect(levelAfter(right(100, { difficulty: "easy" }))).toBe("medium");
  });
  it("goes down only below 40% right (40% exactly stays)", () => {
    expect(levelAfter(right(39))).toBe("easy");
    expect(levelAfter(right(40))).toBe("medium");
    expect(levelAfter(right(0, { difficulty: "expert" }))).toBe("hard");
  });
  it("one bad game is enough, and a game in between changes nothing", () => {
    expect(levelAfter(right(10, { difficulty: "hard" }))).toBe("medium");
    expect(levelAfter(right(65, { difficulty: "hard" }))).toBe("hard");
  });
  it("stays within Easy..Expert", () => {
    expect(levelAfter(right(0, { difficulty: "easy" }))).toBe("easy");
    expect(levelAfter(right(100, { difficulty: "expert" }))).toBe("expert");
  });
  it("counts a game with no questions as nothing right", () => {
    expect(levelAfter(game({ correct_count: 0, total: 0, difficulty: "hard" }))).toBe("medium");
  });
});

describe("progressiveLevel", () => {
  it("starts at Medium when nothing was finished", () => {
    expect(progressiveLevel([], 1, "choice")).toBe("medium");
    expect(progressiveLevel([game({ finished_at: null })], 1, "choice")).toBe("medium");
  });
  it("uses the latest finished game of the song itself", () => {
    const games = [
      right(10, { difficulty: "expert", finished_at: "2026-01-01T00:00:00Z" }),
      right(95, { difficulty: "easy", finished_at: "2026-02-01T00:00:00Z" }),
    ];
    expect(progressiveLevel(games, 1, "choice")).toBe("medium");
  });
  it("a song not played yet carries on from the player's latest finished game (the queue gets harder or easier track by track)", () => {
    const games = [
      right(95, { song_id: 5, difficulty: "hard", finished_at: "2026-03-01T00:00:00Z" }),
      right(10, { song_id: 6, difficulty: "easy", finished_at: "2026-01-01T00:00:00Z" }),
    ];
    expect(progressiveLevel(games, 1, "choice")).toBe("expert");
    expect(progressiveLevel([games[1]!], 1, "choice")).toBe("easy");
  });
  it("its own history beats the carry-over", () => {
    const games = [
      right(50, { song_id: 1, difficulty: "hard", finished_at: "2026-01-01T00:00:00Z" }),
      right(95, { song_id: 5, difficulty: "expert", finished_at: "2026-03-01T00:00:00Z" }),
    ];
    expect(progressiveLevel(games, 1, "choice")).toBe("hard");
  });
  it("tracks each mode apart", () => {
    const games = [right(95, { difficulty: "hard", mode: "typing" })];
    expect(progressiveLevel(games, 1, "choice")).toBe("medium");
    expect(progressiveLevel(games, 1, "typing")).toBe("expert");
  });
});
