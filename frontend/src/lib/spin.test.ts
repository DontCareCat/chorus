import { describe, expect, it } from "vitest";
import { SPIN_DEG_PER_SECOND, stepSpin } from "./spin";
import type { Spin } from "./spin";

const run = (s: Spin, seconds: number, on: boolean): Spin => { for (let t = 0; t < seconds; t += 1 / 60) s = stepSpin(s, 1 / 60, on); return s; };

describe("stepSpin", () => {
  it("speeds up smoothly to full speed, never jumping", () => {
    let s: Spin = { angle: 0, speed: 0 };
    s = stepSpin(s, 1 / 60, true);
    expect(s.speed).toBeGreaterThan(0);
    expect(s.speed).toBeLessThan(SPIN_DEG_PER_SECOND * 0.05);
    expect(run(s, 4, true).speed).toBeGreaterThan(SPIN_DEG_PER_SECOND * 0.99);
  });
  it("slows down to a stop and keeps its angle", () => {
    const going = run({ angle: 0, speed: 0 }, 3, true);
    const stopped = run(going, 5, false);
    expect(stopped.speed).toBe(0);
    expect(run(stopped, 2, false).angle).toBe(stopped.angle);
  });
  it("carries on from the angle it stopped at", () => {
    const stopped = { angle: 123.4, speed: 0 };
    const again = run(stopped, 0.5, true);
    expect(again.angle).toBeGreaterThan(123.4);
    expect(again.angle).toBeLessThan(123.4 + 60);
  });
  it("coasts: the angle still moves while it slows down, by less than at full speed", () => {
    const full: Spin = { angle: 0, speed: SPIN_DEG_PER_SECOND };
    const after = run(full, 0.5, false);
    expect(after.angle).toBeGreaterThan(0);
    expect(after.angle).toBeLessThan(SPIN_DEG_PER_SECOND * 0.5);
  });
});
