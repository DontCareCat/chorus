import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decay, multiplierFor, scoreAnswer, secondsToDecay, untilNextLevel } from "./scoring";

interface Step { correct: boolean; ahead: boolean; waited: number }
interface Case { name: string; steps: Step[]; expect: number[][] }
const vectors = (JSON.parse(readFileSync(new URL("../../../shared/scoring-vectors.json", import.meta.url), "utf8")) as { cases: Case[] }).cases;

describe("scoring (shared vectors, same as the backend)", () => {
  for (const c of vectors) {
    it(c.name, () => {
      let streak = 0;
      c.steps.forEach((step, i) => {
        const o = scoreAnswer(streak, step.correct, step.ahead, step.waited);
        expect([o.points, o.multiplier, o.streak, o.nextMultiplier], `step ${i}`).toEqual(c.expect[i]);
        streak = o.streak;
      });
      expect(c.steps.length).toBe(c.expect.length);
    });
  }
});

describe("multiplier helpers", () => {
  it("levels", () => {
    expect([0, 3, 4, 7, 8, 27, 28, 29, 500].map(multiplierFor)).toEqual([1, 1, 2, 2, 3, 7, 8, 8, 8]);
  });
  it("decay is bounded and clears progress", () => {
    expect(decay(28, 10_000)).toBe(0);
    expect(decay(28, -3)).toBe(28);
    expect(decay(6, 4.99)).toBe(6);
    expect(decay(6, 5)).toBe(0);
    expect(decay(9, 5)).toBe(4);
  });
  it("progress to the next level", () => {
    expect([0, 1, 3, 4, 27, 28].map(untilNextLevel)).toEqual([4, 3, 1, 4, 1, 0]);
  });
  it("countdown cycles every 5 seconds", () => {
    expect(secondsToDecay(0)).toBe(5);
    expect(secondsToDecay(4.5)).toBeCloseTo(0.5);
    expect(secondsToDecay(5)).toBe(5);
    expect(secondsToDecay(7.5)).toBeCloseTo(2.5);
  });
});
