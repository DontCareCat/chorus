import { describe, expect, it } from "vitest";
import { HINT_SCREENS, hintDue } from "./useSwipeHint";

describe("swipe hint", () => {
  it("is due on a fresh device and for the first few screens", () => {
    expect(hintDue(null)).toBe(true);
    expect(hintDue("0")).toBe(true);
    expect(hintDue(String(HINT_SCREENS - 1))).toBe(true);
  });
  it("is over after that, and after the player swiped once", () => {
    expect(hintDue(String(HINT_SCREENS))).toBe(false);
    expect(hintDue("99")).toBe(false);
  });
  it("treats unreadable values as not shown yet", () => {
    expect(hintDue("garbage")).toBe(true);
  });
});
