// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Question } from "./Question";
import type { QuestionResult } from "../game/results";
import type { QuizQuestion } from "../types/question";

afterEach(cleanup);
// jsdom has no ResizeObserver (the sentence box uses it to fit its text)
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const typingQ: QuizQuestion = {
  id: 1, lineId: 1, blankIndex: 0, sequence: 0, startTime: 1, endTime: 2, recoveryTime: 0, questionText: "Das ____ ist da", text: null, word: null, options: [], answer: null,
};
const base = { question: typingQ, siblings: [typingQ], index: 0, total: 3, onAnswer: vi.fn(), typing: true };

describe("typing question", () => {
  it("has a text field and a Check button instead of options; Enter submits the trimmed text", () => {
    const onSubmit = vi.fn();
    render(<Question {...base} results={new Map()} onSubmit={onSubmit} />);
    expect(screen.queryAllByRole("button").filter((b) => b.className.includes("opt"))).toHaveLength(0);
    const field = screen.getByLabelText("Your answer") as HTMLInputElement;
    const check = screen.getByRole("button", { name: "Check" }) as HTMLButtonElement;
    expect(check.disabled).toBe(true); // nothing typed yet
    fireEvent.change(field, { target: { value: "  Haus " } });
    expect(check.disabled).toBe(false);
    fireEvent.submit(field.closest("form")!);
    expect(onSubmit).toHaveBeenCalledWith("Haus");
  });

  it("the answer field is not offered browser or keyboard autofill", () => {
    render(<Question {...base} results={new Map()} onSubmit={vi.fn()} />);
    const field = screen.getByLabelText("Your answer") as HTMLInputElement;
    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(field.closest("form")!.getAttribute("autocomplete")).toBe("off");
    expect(field.getAttribute("autocorrect")).toBe("off");
    expect(field.getAttribute("autocapitalize")).toBe("none");
    expect(field.getAttribute("spellcheck")).toBe("false");
    expect(field.name).toBe("chorus-word-answer"); // not "name", "address", "card"...
    expect(field.getAttribute("data-lpignore")).toBe("true");
    expect(field.getAttribute("data-1p-ignore")).toBe("true");
    expect(field.getAttribute("data-bwignore")).toBe("true");
    expect(field.getAttribute("data-form-type")).toBe("other");
    expect(field.type).toBe("text");
    expect(field.getAttribute("inputmode")).toBe("text");
  });

  it("does not submit an empty answer", () => {
    const onSubmit = vi.fn();
    render(<Question {...base} results={new Map()} onSubmit={onSubmit} />);
    fireEvent.submit((screen.getByLabelText("Your answer") as HTMLInputElement).closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("after the answer the field is locked and shows what was typed and the asked word", () => {
    const results = new Map<number, QuestionResult>([[1, { selectedOptionId: 0, typed: "hous", correct: false, match: "partial", word: "Haus" }]]);
    render(<Question {...base} results={results} onSubmit={vi.fn()} />);
    const field = screen.getByLabelText("Your answer") as HTMLInputElement;
    expect(field.disabled).toBe(true);
    expect(field.value).toBe("hous");
    expect(screen.getAllByText("Almost: Haus").length).toBeGreaterThan(0);
    expect(document.querySelector(".typing")?.getAttribute("data-state")).toBe("partial");
    expect(document.querySelector(".blank[data-active]")?.textContent).toBe("Haus"); // the asked word fills the blank
  });

  it("a wrong typed answer still reveals the right word", () => {
    const results = new Map<number, QuestionResult>([[1, { selectedOptionId: 0, typed: "baum", correct: false, match: "none", word: "Haus" }]]);
    render(<Question {...base} results={results} onSubmit={vi.fn()} />);
    expect(document.querySelector(".blank[data-active]")?.textContent).toBe("Haus");
    expect(screen.getByText("The word was Haus")).toBeTruthy();
  });

  it("the phone layout (answers only) hides the sentence but keeps the field", () => {
    render(<Question {...base} answersOnly results={new Map()} onSubmit={vi.fn()} />);
    expect(document.querySelector(".prompt")).toBeNull();
    expect(screen.getByLabelText("Your answer")).toBeTruthy();
  });
});
