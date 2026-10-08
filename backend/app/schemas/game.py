from datetime import datetime

from pydantic import BaseModel, Field


class OptionOut(BaseModel):
    id: int
    text: str  # is_correct is never sent before the question is answered


class AnswerOut(BaseModel):
    selected_option_id: int
    correct: bool
    correct_option_id: int
    answered_at: datetime


class QuestionOut(BaseModel):
    id: int
    line_id: int
    blank_index: int  # which blank of the line this question asks (the sentence hides all of the line's blanks)
    sequence: int  # order of the question within the game
    audio_start: float | None  # None for unsynchronized lyrics (free play)
    audio_end: float | None
    recovery_start: float | None  # start of the previous lyric line (own start for the first line); None if unsynced
    question_text: str
    text: str | None  # full original line; revealed only after the question is answered
    options: list[OptionOut]
    answer: AnswerOut | None


class ProgressOut(BaseModel):
    answered: int
    total: int
    score: int


class GameOut(BaseModel):
    public_id: str
    song_id: int
    song_title: str
    song_artist: str
    song_duration: float
    language: str
    difficulty: str
    synced: bool  # False → free-play mode, no playback gating
    lyrics_offset: float  # seconds; applied once on the frontend when mapping lyric time to audio time
    started_at: datetime
    finished_at: datetime | None
    progress: ProgressOut
    questions: list[QuestionOut]


class GameSummary(BaseModel):
    public_id: str
    song_id: int
    difficulty: str
    started_at: datetime
    finished_at: datetime | None
    score: int


class GameCreate(BaseModel):
    song_id: int
    difficulty: str = Field("medium", max_length=16)


class AnswerIn(BaseModel):
    question_id: int
    option_id: int


class AnswerResult(BaseModel):
    correct: bool
    correct_option_id: int
    text: str  # the full line, now revealed
    score: int
    already_answered: bool = False
    finished: bool = False
