import type { GameDto } from "../types/game";
import type { QuizQuestion } from "../types/question";
import type { SyncQuestion } from "./synchronization";
import { toAudioTime } from "./timing";

export function buildQuiz(game: GameDto): QuizQuestion[] {
  const t = (v: number | null) => (v === null ? null : toAudioTime(v, game.lyrics_offset));
  return game.questions
    .map((q) => ({
      id: q.id,
      lineId: q.line_id,
      blankIndex: q.blank_index,
      sequence: q.sequence,
      startTime: t(q.audio_start),
      endTime: t(q.audio_end),
      recoveryTime: t(q.recovery_start),
      questionText: q.question_text,
      text: q.text,
      options: q.options,
      answer: q.answer,
    }))
    .sort((a, b) => a.sequence - b.sequence);
}

export function answeredIds(quiz: readonly QuizQuestion[]): Set<number> {
  return new Set(quiz.filter((q) => q.answer !== null).map((q) => q.id));
}

/** Questions that take part in playback gating. Unsynchronized lyrics (free play) yield none. */
export function syncQuestions(quiz: readonly QuizQuestion[]): SyncQuestion[] {
  const out: SyncQuestion[] = [];
  for (const q of quiz) {
    if (q.startTime === null || q.endTime === null) continue;
    out.push({
      id: q.id,
      sequence: q.sequence,
      startTime: q.startTime,
      endTime: q.endTime,
      recoveryTime: q.recoveryTime ?? q.startTime,
    });
  }
  return out;
}
