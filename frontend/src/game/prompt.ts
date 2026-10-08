import type { QuizQuestion } from "../types/question";

export const BLANK = "____";

export type PromptPart =
  | { kind: "text"; text: string }
  | {
      kind: "blank";
      index: number;
      /** active: the blank this question asks; open: another unanswered blank of the line; filled: an answered one */
      state: "active" | "open" | "filled";
      word?: string;
    };

/** The word an answered question stands for (its right answer), or undefined while it is open. */
export type WordOf = (q: QuizQuestion) => string | undefined;

/**
 * Split a sentence into text and blanks. A line can have several blanks (one question each); every blank is
 * hidden until ITS question is answered, so answering one question never reveals another.
 */
export function buildPrompt(question: QuizQuestion, siblings: readonly QuizQuestion[], wordOf: WordOf): PromptPart[] {
  const pieces = question.questionText.split(BLANK);
  const byIndex = new Map(siblings.map((s) => [s.blankIndex, s]));
  const parts: PromptPart[] = [];
  pieces.forEach((text, i) => {
    if (text) parts.push({ kind: "text", text });
    if (i < pieces.length - 1) {
      const sib = byIndex.get(i);
      const word = sib && sib.id !== question.id ? wordOf(sib) : undefined;
      if (i === question.blankIndex) parts.push({ kind: "blank", index: i, state: "active" });
      else if (word !== undefined) parts.push({ kind: "blank", index: i, state: "filled", word });
      else parts.push({ kind: "blank", index: i, state: "open" });
    }
  });
  return parts;
}

export interface LineGroup {
  lineId: number;
  questions: QuizQuestion[];
}

/** Questions grouped by lyric line, in song order. */
export function groupByLine(quiz: readonly QuizQuestion[]): LineGroup[] {
  const groups: LineGroup[] = [];
  const byLine = new Map<number, LineGroup>();
  for (const q of quiz) {
    let g = byLine.get(q.lineId);
    if (!g) {
      g = { lineId: q.lineId, questions: [] };
      byLine.set(q.lineId, g);
      groups.push(g);
    }
    g.questions.push(q);
  }
  for (const g of groups) g.questions.sort((a, b) => a.blankIndex - b.blankIndex);
  return groups;
}
