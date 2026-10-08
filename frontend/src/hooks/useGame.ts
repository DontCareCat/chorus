import { useCallback, useMemo, useState } from "react";
import { answeredIds, buildQuiz, syncQuestions } from "../game/state";
import type { SyncQuestion } from "../game/synchronization";
import { api } from "../services/api";
import type { AnswerResultDto } from "../services/api";
import type { GameDto } from "../types/game";
import type { QuizQuestion } from "../types/question";

export interface QuestionResult {
  selectedOptionId: number;
  /** undefined until the server has confirmed (the answer already counts as given). */
  correct?: boolean;
  correctOptionId?: number;
  text?: string;
}

export interface UseGame {
  quiz: QuizQuestion[];
  /** Persisted + optimistic answers, by question id. */
  results: ReadonlyMap<number, QuestionResult>;
  answeredSet: ReadonlySet<number>;
  syncQs: SyncQuestion[];
  synced: boolean;
  score: number;
  total: number;
  finished: boolean;
  error: string | null;
  /** Records the answer immediately (never waits for the network) and then confirms with the server. */
  answer: (questionId: number, optionId: number, onLocal: () => void) => void;
}

export function useGame(game: GameDto): UseGame {
  const quiz = useMemo(() => buildQuiz(game), [game]);
  const [optimistic, setOptimistic] = useState<Map<number, QuestionResult>>(new Map());
  const [confirmed, setConfirmed] = useState<Map<number, AnswerResultDto>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const results = useMemo(() => {
    const m = new Map<number, QuestionResult>();
    for (const q of quiz) {
      if (q.answer) {
        m.set(q.id, { selectedOptionId: q.answer.selected_option_id, correct: q.answer.correct, correctOptionId: q.answer.correct_option_id, text: q.text ?? undefined });
      }
    }
    for (const [id, r] of optimistic) m.set(id, r);
    for (const [id, r] of confirmed) {
      const prev = m.get(id);
      m.set(id, { selectedOptionId: prev?.selectedOptionId ?? 0, correct: r.correct, correctOptionId: r.correct_option_id, text: r.text });
    }
    return m;
  }, [quiz, optimistic, confirmed]);

  const answeredSet = useMemo(() => new Set([...answeredIds(quiz), ...optimistic.keys()]), [quiz, optimistic]);
  const syncQs = useMemo(() => (game.synced ? syncQuestions(quiz) : []), [game.synced, quiz]);

  const answer = useCallback(
    (questionId: number, optionId: number, onLocal: () => void) => {
      if (answeredSet.has(questionId)) return;
      setOptimistic((m) => new Map(m).set(questionId, { selectedOptionId: optionId }));
      onLocal(); // tells the playback controller right away: the fade-in must not wait for the server
      api.answer(game.public_id, questionId, optionId).then(
        (r) => setConfirmed((m) => new Map(m).set(questionId, r)),
        (e: Error) => setError(e.message),
      );
    },
    [answeredSet, game.public_id],
  );

  const score = [...results.values()].filter((r) => r.correct).length;
  return {
    quiz, results, answeredSet, syncQs, synced: game.synced, score, total: quiz.length,
    finished: quiz.length > 0 && answeredSet.size >= quiz.length, error, answer,
  };
}
