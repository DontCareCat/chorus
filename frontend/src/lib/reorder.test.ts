import { describe, expect, it } from "vitest";
import { edgeScroll, moveItem, shifts, targetIndex } from "./reorder";

describe("moveItem", () => {
  it("moves down and up without touching the input", () => {
    const a = [1, 2, 3, 4];
    expect(moveItem(a, 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem(a, 3, 1)).toEqual([1, 4, 2, 3]);
    expect(a).toEqual([1, 2, 3, 4]);
  });
});

describe("targetIndex", () => {
  const mids = [50, 150, 250, 350];
  it("stays put while the dragged row's middle is still in its own slot", () => {
    expect(targetIndex(mids, 1, 150)).toBe(1);
    expect(targetIndex(mids, 1, 120)).toBe(1);
  });
  it("moves down once the middle passes the next row's middle", () => {
    expect(targetIndex(mids, 1, 260)).toBe(2);
    expect(targetIndex(mids, 0, 999)).toBe(3);
  });
  it("moves up once it passes the previous row's middle", () => {
    expect(targetIndex(mids, 2, 140)).toBe(1);
    expect(targetIndex(mids, 3, -10)).toBe(0);
  });
});

describe("shifts", () => {
  it("rows between slide up when the dragged row goes down", () => expect(shifts(5, 1, 3, 40)).toEqual([0, 0, -40, -40, 0]));
  it("rows between slide down when it goes up", () => expect(shifts(5, 3, 1, 40)).toEqual([0, 40, 40, 0, 0]));
  it("nothing moves when it stays", () => expect(shifts(3, 1, 1, 40)).toEqual([0, 0, 0]));
});

describe("edgeScroll", () => {
  it("scrolls up near the top, down near the bottom, never in the middle", () => {
    expect(edgeScroll(10, 0, 800)).toBeLessThan(0);
    expect(edgeScroll(790, 0, 800)).toBeGreaterThan(0);
    expect(edgeScroll(400, 0, 800)).toBe(0);
  });
  it("is faster closer to the edge", () => expect(edgeScroll(5, 0, 800)).toBeLessThan(edgeScroll(40, 0, 800)));
});
