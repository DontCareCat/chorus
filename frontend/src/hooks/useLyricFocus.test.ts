import { describe, expect, it } from "vitest";
import { parseLyricFocus } from "./useLyricFocus";

describe("parseLyricFocus", () => {
  it("defaults to the next question", () => {
    expect(parseLyricFocus(null)).toBe("question");
    expect(parseLyricFocus("garbage")).toBe("question");
  });
  it("reads the saved choice", () => {
    expect(parseLyricFocus("line")).toBe("line");
    expect(parseLyricFocus("question")).toBe("question");
  });
});
