import { useCallback, useMemo, useRef, useState } from "react";
import type { QuestionResult } from "../game/results";
import { answeredIds, buildQuiz, syncQuestions } from "../game/state";
import type { SyncQuestion } from "../game/synchronization";
import { api } from "../services/api";
import type { Answer } from "../services/api";
import type { AnswerResultDto } from "../services/api";
import type { GameDto } from "../types/game";
import type { QuizQuestion } from "../types/question";

export type { QuestionResult } from "../game/results";

export interface Standing {
  points: number;
  streak: number;
  /** The multiplier the next correct answer would get (before any waiting decay). */
  multiplier: number;
  best: number;
}

/** What the last answer earned, for the "+25" pop. `id` changes with every answer. */
export interface Gain {
  id: number;
  points: number;
  ahead: boolean;
  multiplier: number;
  correct: boolean;
}

export interface UseGame {
  quiz: QuizQuestion[];
  /** Persisted + optimistic answers, by question id. */
  results: ReadonlyMap<number, QuestionResult>;
  answeredSet: ReadonlySet<number>;
  syncQs: SyncQuestion[];
  synced: boolean;
  standing: Standing;
  gain: Gain | null;
  /** Number of right answers (for the finish message). */
  correct: number;
  total: number;
  finished: boolean;
  error: string | null;
  /** Records the answer immediately (never waits for the network) and then confirms with the server. */
  answer: (questionId: number, answer: Answer, ctx: { position: number | null; waited: number }, onLocal: () => void) => void;
}

export function useGame(game: GameDto): UseGame {
  const quiz = useMemo(() => buildQuiz(game), [game]);
  const [optimistic, setOptimistic] = useState<Map<number, QuestionResult>>(new Map());
  const [confirmed, setConfirmed] = useState<Map<number, AnswerResultDto>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [standing, setStanding] = useState<Standing>({
    points: game.progress.score, streak: game.progress.streak, multiplier: game.progress.multiplier, best: game.progress.best_multiplier,
  });
  const [gain, setGain] = useState<Gain | null>(null);
  const sent = useRef(0);
  const applied = useRef(0);

  const results = useMemo(() => {
    const m = new Map<number, QuestionResult>();
    for (const q of quiz) {
      if (q.answer) {
        const a = q.answer;
        m.set(q.id, {
          selectedOptionId: a.selected_option_id ?? 0, correct: a.correct, correctOptionId: a.correct_option_id ?? undefined, text: q.text ?? undefined,
          ...(a.match ? { typed: a.typed_text ?? undefined, match: a.match, word: a.word ?? q.word ?? undefined } : {}),
        });
      }
    }
    for (const [id, r] of optimistic) m.set(id, r);
    for (const [id, r] of confirmed) {
      const prev = m.get(id);
      m.set(id, {
        selectedOptionId: prev?.selectedOptionId ?? 0, correct: r.correct, correctOptionId: r.correct_option_id ?? undefined, text: r.text,
        ...(r.match ? { typed: prev?.typed, match: r.match, word: r.word ?? undefined } : {}),
      });
    }
    return m;
  }, [quiz, optimistic, confirmed]);

  const answeredSet = useMemo(() => new Set([...answeredIds(quiz), ...optimistic.keys()]), [quiz, optimistic]);
  const syncQs = useMemo(() => (game.synced ? syncQuestions(quiz) : []), [game.synced, quiz]);

  const answer = useCallback(
    (questionId: number, given: Answer, ctx: { position: number | null; waited: number }, onLocal: () => void) => {
      if (answeredSet.has(questionId)) return;
      setOptimistic((m) => new Map(m).set(questionId, "optionId" in given ? { selectedOptionId: given.optionId } : { selectedOptionId: 0, typed: given.text }));
      onLocal(); // tells the playback controller right away: the fade-in must not wait for the server
      const seq = ++sent.current;
      api.answer(game.public_id, questionId, given, ctx.position, ctx.waited).then(
        (r) => {
          setConfirmed((m) => new Map(m).set(questionId, r));
          if (r.already_answered) return;
          setGain({ id: seq, points: r.points, ahead: r.ahead, multiplier: r.multiplier, correct: r.points > 0 });
          if (seq > applied.current) {
            applied.current = seq; // answers can be confirmed out of order: the newest one describes the game
            setStanding((s) => ({ points: r.score, streak: r.streak, multiplier: r.next_multiplier, best: Math.max(s.best, r.next_multiplier) }));
          }
        },
        (e: Error) => setError(e.message),
      );
    },
    [answeredSet, game.public_id],
  );

  const correct = [...results.values()].filter((r) => r.correct).length;
  return {
    quiz, results, answeredSet, syncQs, synced: game.synced, standing, gain, correct, total: quiz.length,
    finished: quiz.length > 0 && answeredSet.size >= quiz.length, error, answer,
  };
}
