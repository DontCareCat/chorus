import { describe, expect, it } from "vitest";
import { scrollTarget } from "./scroll-into-view";

const view = { viewTop: 60, viewBottom: 800, margin: 12 };

describe("scrollTarget", () => {
  it("does nothing when everything is visible", () => {
    expect(scrollTarget({ itemTop: 200, panelBottom: 500, ...view })).toBe(0);
  });
  it("scrolls down just enough to show the bottom of a panel that fits", () => {
    expect(scrollTarget({ itemTop: 400, panelBottom: 900, ...view })).toBe(112); // 900 - (800 - 12)
  });
  it("gives the top priority when the block is taller than the screen", () => {
    expect(scrollTarget({ itemTop: 300, panelBottom: 1200, ...view })).toBe(228); // row top goes to viewTop + margin
  });
  it("scrolls up when the row is cut off at the top", () => {
    expect(scrollTarget({ itemTop: 20, panelBottom: 300, ...view })).toBe(-52);
  });
});
