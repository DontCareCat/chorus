import { describe, expect, it } from "vitest";
import { buildWindowLines, centerOffset, currentLineIndex, timecode } from "./lyric-window";
import type { QuestionResult } from "./results";
import type { QuizQuestion } from "../types/question";

const q = (id: number, lineId: number, blankIndex: number, questionText: string, right: number): QuizQuestion => ({
  id, lineId, blankIndex, sequence: id, startTime: 0, endTime: 1, recoveryTime: 0, questionText, text: null, answer: null,
  options: [{ id: id * 10, text: "Haus" }, { id: id * 10 + 1, text: "Baum" }, { id: id * 10 + 2, text: "Auto" }, { id: id * 10 + 3, text: "Stadt" }].map((o, i) => (i === right ? { ...o } : o)),
});

const lines = [
  { line_id: 1, audio_start: 0, text: "Ein ganz normaler Satz" },
  { line_id: 2, audio_start: 5, text: null },
  { line_id: 3, audio_start: 10, text: "Noch ein Satz" },
];
const quiz = [q(1, 2, 0, "Ich sehe ein ____ und einen ____ dort", 0), q(2, 2, 1, "Ich sehe ein ____ und einen ____ dort", 1)];

describe("buildWindowLines", () => {
  it("plain lines carry their text, question lines start as blanks", () => {
    const w = buildWindowLines(lines, quiz, new Map(), 0, 1);
    expect(w[0]).toMatchObject({ status: "plain", targetId: null, parts: [{ kind: "text", text: "Ein ganz normaler Satz" }] });
    expect(w[1]!.status).toBe("open");
    expect(w[1]!.parts.map((p) => p.kind)).toEqual(["text", "blank", "text", "blank", "text"]);
    expect(w[1]!.parts.filter((p) => p.kind === "blank" && p.focused)).toHaveLength(1);
    expect(w[1]!.targetId).toBe(1);
  });

  it("applies the lyrics offset to the start time", () => {
    expect(buildWindowLines(lines, quiz, new Map(), 2.5, null).map((l) => l.startTime)).toEqual([2.5, 7.5, 12.5]);
    expect(buildWindowLines([{ line_id: 9, audio_start: null, text: "x" }], [], new Map(), 3, null)[0]!.startTime).toBeNull();
  });

  it("shows the RIGHT word whatever the player chose, coloured by how they did", () => {
    const results = new Map<number, QuestionResult>([
      [1, { selectedOptionId: 10, correct: true, correctOptionId: 10 }],
      [2, { selectedOptionId: 20, correct: false, correctOptionId: 21 }],
    ]);
    const l = buildWindowLines(lines, quiz, results, 0, null)[1]!;
    const words = l.parts.filter((p) => p.kind === "word");
    expect(words.map((p) => p.kind === "word" && [p.word, p.state])).toEqual([["Haus", "correct"], ["Baum", "wrong"]]);
    expect(l.status).toBe("wrong");
    expect(l.targetId).toBe(1); // all answered: the first question
  });

  it("a line with only right answers is correct; an unconfirmed answer shows the chosen word as pending", () => {
    const right = new Map<number, QuestionResult>([
      [1, { selectedOptionId: 10, correct: true, correctOptionId: 10 }],
      [2, { selectedOptionId: 21, correct: true, correctOptionId: 21 }],
    ]);
    expect(buildWindowLines(lines, quiz, right, 0, null)[1]!.status).toBe("correct");
    const pending = new Map<number, QuestionResult>([[1, { selectedOptionId: 11 }]]);
    const l = buildWindowLines(lines, quiz, pending, 0, null)[1]!;
    expect(l.parts.find((p) => p.kind === "word")).toMatchObject({ word: "Baum", state: "pending" });
    expect(l.status).toBe("open");
    expect(l.targetId).toBe(2); // the first still-open question
  });

  it("answering one blank never reveals another", () => {
    const one = new Map<number, QuestionResult>([[1, { selectedOptionId: 10, correct: true, correctOptionId: 10 }]]);
    const parts = buildWindowLines(lines, quiz, one, 0, null)[1]!.parts;
    expect(parts.filter((p) => p.kind === "word")).toHaveLength(1);
    expect(parts.filter((p) => p.kind === "blank")).toHaveLength(1);
  });
});

describe("currentLineIndex", () => {
  const ls = buildWindowLines(lines, quiz, new Map(), 0, null);
  it("is the last line that has started, the first one before the song begins", () => {
    expect([-1, 0, 4.9, 5, 9.99, 10, 99].map((t) => currentLineIndex(ls, t, true, 0))).toEqual([0, 0, 0, 1, 1, 2, 2]);
  });
  it("follows the focused line without timing", () => {
    expect(currentLineIndex(ls, 99, false, 1)).toBe(1);
    expect(currentLineIndex(ls, 99, false, -1)).toBe(0);
  });
  it("copes with no lines", () => expect(currentLineIndex([], 3, true, 0)).toBe(-1));
});

describe("helpers", () => {
  it("centers a line in the viewport", () => {
    expect(centerOffset(300, 0, 40)).toBe(130);
    expect(centerOffset(300, 400, 40)).toBe(-270);
  });
  it("formats timecodes", () => {
    expect([null, 0, 59.9, 61, 3599].map(timecode)).toEqual(["", "0:00", "0:59", "1:01", "59:59"]);
  });
});
