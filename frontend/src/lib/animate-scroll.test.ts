// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { animateScrollBy, easeOut } from "./scroll-into-view";

describe("animateScrollBy", () => {
  let y = 0;
  let now = 0;
  let queue: FrameRequestCallback[] = [];
  const frame = (ms: number) => { now += ms; const run = queue; queue = []; run.forEach((f) => f(now)); };
  beforeEach(() => {
    y = 100; now = 0; queue = [];
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => (queue.push(f), queue.length));
    vi.stubGlobal("cancelAnimationFrame", () => { queue = []; });
    vi.spyOn(performance, "now").mockImplementation(() => now);
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
    window.scrollBy = ((a: number, b?: number) => { y += typeof a === "number" ? (b ?? 0) : 0; }) as typeof window.scrollBy;
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("moves in steps over the duration and lands exactly on the target", () => {
    animateScrollBy(300, { ms: 300 });
    frame(16);
    expect(y).toBeGreaterThan(100);
    expect(y).toBeLessThan(400); // it did not jump at once
    const first = y;
    frame(100);
    expect(y).toBeGreaterThan(first);
    frame(300);
    expect(y).toBe(400);
    expect(queue.length).toBe(0);
  });
  it("scrolls at once for people who asked for no motion", () => {
    animateScrollBy(300, { reduced: true });
    expect(y).toBe(400);
  });
  it("a newer scroll takes over from the running one", () => {
    animateScrollBy(300, { ms: 300 });
    frame(100);
    animateScrollBy(-50, { ms: 100 });
    const from = y;
    frame(200);
    expect(y).toBe(from - 50);
  });
  it("eases out", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});
