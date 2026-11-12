import { describe, expect, it } from "vitest";
import { easeOutCubic, scrollDuration, scrollPosition } from "./smooth-scroll";

describe("smooth scroll", () => {
  it("starts at the start and ends exactly at the target", () => {
    expect(scrollPosition(100, 400, 0)).toBe(100);
    expect(scrollPosition(100, 400, scrollDuration(300))).toBe(400);
    expect(scrollPosition(100, 400, 99999)).toBe(400);
  });
  it("never passes the target in either direction (no overshoot and return)", () => {
    for (const [from, to] of [[0, 500], [500, 0], [120, 160]] as const) {
      const d = scrollDuration(to - from);
      for (let t = 0; t <= d + 100; t += 7) {
        const p = scrollPosition(from, to, t);
        expect(p).toBeGreaterThanOrEqual(Math.min(from, to));
        expect(p).toBeLessThanOrEqual(Math.max(from, to));
      }
    }
  });
  it("only ever moves towards the target", () => {
    let last = scrollPosition(0, 300, 0);
    for (let t = 10; t <= 500; t += 10) { const p = scrollPosition(0, 300, t); expect(p).toBeGreaterThanOrEqual(last); last = p; }
  });
  it("eases out and clamps its input", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
  it("keeps short hops quick and long jumps bounded", () => {
    expect(scrollDuration(10)).toBe(220);
    expect(scrollDuration(5000)).toBe(420);
  });
});
