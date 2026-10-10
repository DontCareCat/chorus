import type { Match } from "../types/game";
import type { QuizQuestion } from "../types/question";

export interface QuestionResult {
  /** The chosen option (0 in typing mode). */
  selectedOptionId: number;
  /** undefined until the server has confirmed (the answer already counts as given). A full match in typing mode. */
  correct?: boolean;
  correctOptionId?: number;
  text?: string;
  /** Typing mode: what was typed, how it was judged and the word that was asked. */
  typed?: string;
  match?: Match;
  word?: string;
}

/** The word a question stands for once answered: its right answer. */
export function rightWord(q: QuizQuestion, r: QuestionResult | undefined): string | undefined {
  if (!r) return undefined;
  if (r.word !== undefined) return r.word;
  if (r.correctOptionId === undefined) return undefined;
  return q.options.find((o) => o.id === r.correctOptionId)?.text;
}

export function resultWord(q: QuizQuestion, r: QuestionResult | undefined): { word: string; ok: boolean | undefined; match?: Match } | null {
  if (!r) return null;
  const chosen = r.typed ?? q.options.find((o) => o.id === r.selectedOptionId)?.text;
  const right = rightWord(q, r);
  if (r.match !== undefined) return { word: right ?? chosen ?? "", ok: r.match === "full", match: r.match }; // typing mode: always show the asked word
  if (r.correct === undefined) return chosen ? { word: chosen, ok: undefined } : null;
  return { word: (r.correct ? chosen : right) ?? chosen ?? "", ok: r.correct };
}
