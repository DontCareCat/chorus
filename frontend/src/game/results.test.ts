import { describe, expect, it } from "vitest";
import { resultWord, rightWord } from "./results";
import type { QuizQuestion } from "../types/question";

const q = (options: { id: number; text: string }[]): QuizQuestion => ({
  id: 1, lineId: 1, blankIndex: 0, sequence: 0, startTime: 0, endTime: 1, recoveryTime: 0, questionText: "____ x", text: null, word: null, options, answer: null,
});

describe("results", () => {
  const choice = q([{ id: 1, text: "Haus" }, { id: 2, text: "Baum" }]);
  it("multiple choice: the right word by option id, the chosen one when right", () => {
    expect(rightWord(choice, { selectedOptionId: 2, correct: false, correctOptionId: 1 })).toBe("Haus");
    expect(resultWord(choice, { selectedOptionId: 1, correct: true, correctOptionId: 1 })).toEqual({ word: "Haus", ok: true });
    expect(resultWord(choice, { selectedOptionId: 2, correct: false, correctOptionId: 1 })).toEqual({ word: "Haus", ok: false });
    expect(resultWord(choice, { selectedOptionId: 2 })).toEqual({ word: "Baum", ok: undefined }); // not confirmed yet
    expect(resultWord(choice, undefined)).toBeNull();
  });
  const typing = q([]);
  it("typing: the asked word is always the one shown; partial is not ok", () => {
    expect(resultWord(typing, { selectedOptionId: 0, typed: "hous", correct: false, match: "partial", word: "Haus" })).toEqual({ word: "Haus", ok: false, match: "partial" });
    expect(resultWord(typing, { selectedOptionId: 0, typed: "HAUS", correct: true, match: "full", word: "Haus" })).toEqual({ word: "Haus", ok: true, match: "full" });
    expect(resultWord(typing, { selectedOptionId: 0, typed: "hous" })).toEqual({ word: "hous", ok: undefined }); // typed, not judged yet
    expect(rightWord(typing, { selectedOptionId: 0, typed: "hous" })).toBeUndefined();
  });
});
