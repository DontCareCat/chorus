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

describe("followStep / followSmoothly", () => {
  it("closes a share of the gap each frame, never past the target, and lands exactly", async () => {
    const { followStep } = await import("./smooth-scroll");
    let v = 0;
    const seen: number[] = [];
    for (let i = 0; i < 60; i++) { v = followStep(v, 100); seen.push(v); }
    expect(seen.every((x) => x <= 100)).toBe(true);
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen.every((x, i) => i === 0 || x >= seen[i - 1]!)).toBe(true);
    expect(v).toBe(100);
  });

  it("with instant places the scroll on the target at once", async () => {
    const { followSmoothly } = await import("./smooth-scroll");
    const el = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 } as HTMLElement;
    followSmoothly(el, () => 345.4, 380, true);
    expect(el.scrollTop).toBe(345);
  });
});

describe("followInSync", () => {
  it("runs the CSS curve and lands exactly", async () => {
    const { cubicBezier, easeStandard } = await import("./smooth-scroll");
    expect(easeStandard(0)).toBe(0);
    expect(easeStandard(1)).toBe(1);
    expect(cubicBezier(0, 0, 1, 1, 0.37)).toBeCloseTo(0.37, 3);
    expect(easeStandard(0.5)).toBeGreaterThan(0.5);
    let last = 0;
    for (let t = 0; t <= 1; t += 0.05) { const v = easeStandard(t); expect(v).toBeGreaterThanOrEqual(last); last = v; }
  });
  it("places at once when instant", async () => {
    const { followInSync } = await import("./smooth-scroll");
    const el = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 } as HTMLElement;
    followInSync(el, () => 345.4, 320, true);
    expect(el.scrollTop).toBe(345);
  });
});
