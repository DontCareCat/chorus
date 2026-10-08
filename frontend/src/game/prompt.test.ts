import { describe, expect, it } from "vitest";
import { buildPrompt, groupByLine } from "./prompt";
import type { QuizQuestion } from "../types/question";

const q = (id: number, lineId: number, blankIndex: number, text: string): QuizQuestion => ({
  id, lineId, blankIndex, sequence: id, startTime: 0, endTime: 1, recoveryTime: 0, questionText: text, text: null, options: [], answer: null,
});
const SENTENCE = "Wir ____ mit dem ____ zum ____";
const a = q(1, 7, 0, SENTENCE), b = q(2, 7, 1, SENTENCE), c = q(3, 7, 2, SENTENCE);
const none = () => undefined;

describe("buildPrompt", () => {
  it("marks the asked blank active and the others open — never showing their words", () => {
    const parts = buildPrompt(b, [a, b, c], none);
    expect(parts.filter((p) => p.kind === "blank").map((p) => p.kind === "blank" && p.state)).toEqual(["open", "active", "open"]);
    const text = parts.map((p) => (p.kind === "text" ? p.text : "_")).join("");
    expect(text).toBe("Wir _ mit dem _ zum _");
  });
  it("fills in sibling blanks only once THEIR question is answered", () => {
    const wordOf = (x: QuizQuestion) => (x.id === 1 ? "fahren" : undefined);
    const blanks = buildPrompt(b, [a, b, c], wordOf).filter((p) => p.kind === "blank");
    expect(blanks).toEqual([
      { kind: "blank", index: 0, state: "filled", word: "fahren" },
      { kind: "blank", index: 1, state: "active" },
      { kind: "blank", index: 2, state: "open" },
    ]);
  });
  it("the active blank stays active even after its own answer (the panel colours it)", () => {
    expect(buildPrompt(a, [a, b, c], () => "x").find((p) => p.kind === "blank")).toMatchObject({ state: "active" });
  });
  it("handles a sentence that starts or ends with a blank, and a single blank", () => {
    const only = q(9, 1, 0, "____ und ____");
    expect(buildPrompt(only, [only], none).map((p) => p.kind)).toEqual(["blank", "text", "blank"]);
    expect(buildPrompt(q(8, 1, 0, "Hallo ____"), [], none).map((p) => p.kind)).toEqual(["text", "blank"]);
  });
});

describe("groupByLine", () => {
  it("keeps song order and orders blanks left to right", () => {
    const other = q(4, 8, 0, "Der ____ scheint");
    const groups = groupByLine([c, a, other, b]);
    expect(groups.map((g) => [g.lineId, g.questions.map((x) => x.id)])).toEqual([[7, [1, 2, 3]], [8, [4]]]);
  });
});
