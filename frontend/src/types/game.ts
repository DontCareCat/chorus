// Mirrors the backend GameOut (app/schemas/game.py).
export interface OptionDto {
  id: number;
  text: string;
}

export interface AnswerDto {
  selected_option_id: number;
  correct: boolean;
  correct_option_id: number;
  answered_at: string;
}

export interface QuestionDto {
  id: number;
  line_id: number;
  blank_index: number;
  sequence: number;
  audio_start: number | null;
  audio_end: number | null;
  recovery_start: number | null;
  question_text: string;
  text: string | null;
  options: OptionDto[];
  answer: AnswerDto | null;
}

export interface GameDto {
  public_id: string;
  song_id: number;
  song_title: string;
  song_artist: string;
  song_duration: number;
  language: string;
  difficulty: string;
  synced: boolean;
  lyrics_offset: number;
  started_at: string;
  finished_at: string | null;
  progress: { answered: number; total: number; score: number };
  questions: QuestionDto[];
}
