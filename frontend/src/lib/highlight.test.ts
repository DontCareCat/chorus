import { describe, expect, it } from "vitest";
import { highlight } from "./highlight";

describe("highlight", () => {
  it("marks the whole word in any case", () => {
    expect(highlight("Ich liebe meine Wohnung", "wohnung")).toEqual([{ text: "Ich liebe meine ", hit: false }, { text: "Wohnung", hit: true }]);
  });
  it("does not mark a word inside another word", () => {
    expect(highlight("Haus und Hausmeister", "Haus")).toEqual([{ text: "Haus", hit: true }, { text: " und Hausmeister", hit: false }]);
  });
  it("handles accents, punctuation and regex characters", () => {
    expect(highlight("Où est l'été?", "été")[1]).toEqual({ text: "été", hit: true });
    expect(highlight("a (b) c", "(b)").find((p) => p.hit)?.text).toBe("(b)"); // not read as a pattern
  });
  it("marks every occurrence and copes with an empty word", () => {
    expect(highlight("la la la", "la").filter((p) => p.hit)).toHaveLength(3);
    expect(highlight("text", " ")).toEqual([{ text: "text", hit: false }]);
  });
});
