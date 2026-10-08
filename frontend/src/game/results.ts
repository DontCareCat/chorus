import type { QuizQuestion } from "../types/question";

export interface QuestionResult {
  selectedOptionId: number;
  /** undefined until the server has confirmed (the answer already counts as given). */
  correct?: boolean;
  correctOptionId?: number;
  text?: string;
}

/** The word a question stands for once answered: its right answer. */
export function rightWord(q: QuizQuestion, r: QuestionResult | undefined): string | undefined {
  if (!r || r.correctOptionId === undefined) return undefined;
  return q.options.find((o) => o.id === r.correctOptionId)?.text;
}

export function resultWord(q: QuizQuestion, r: QuestionResult | undefined): { word: string; ok: boolean | undefined } | null {
  if (!r) return null;
  const chosen = q.options.find((o) => o.id === r.selectedOptionId)?.text;
  const right = rightWord(q, r);
  if (r.correct === undefined) return chosen ? { word: chosen, ok: undefined } : null;
  return { word: (r.correct ? chosen : right) ?? chosen ?? "", ok: r.correct };
}
