import type { AnswerDto, OptionDto } from "./game";

/** A question with all lyric times already mapped to audio time (offset applied once, in game/timing.ts). */
export interface QuizQuestion {
  id: number;
  lineId: number;
  blankIndex: number; // which blank of the line this question asks
  sequence: number;
  startTime: number | null; // null → unsynchronized lyrics (free play)
  endTime: number | null;
  recoveryTime: number | null; // start of the previous lyric line
  questionText: string;
  text: string | null;
  options: OptionDto[];
  answer: AnswerDto | null;
}
