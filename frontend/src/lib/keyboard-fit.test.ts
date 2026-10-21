import { describe, expect, it } from "vitest";
import { keyboardFit } from "./keyboard-fit";

describe("keyboardFit", () => {
  it("is closed when the visual viewport is as tall as the page", () => {
    expect(keyboardFit(800, { height: 800, offsetTop: 0, scale: 1 }).open).toBe(false);
  });
  it("ignores the browser bars sliding (a few dozen pixels)", () => {
    expect(keyboardFit(800, { height: 740, offsetTop: 0, scale: 1 }).open).toBe(false);
  });
  it("is open when a keyboard takes the bottom, and reports the visible area", () => {
    expect(keyboardFit(800, { height: 480, offsetTop: 96, scale: 1 })).toEqual({ open: true, top: 96, height: 480 });
  });
  it("does not take a pinch zoom for a keyboard", () => {
    expect(keyboardFit(800, { height: 400, offsetTop: 0, scale: 2 }).open).toBe(false);
  });
});
