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
    score: int  # points
    correct: int
    streak: int
    multiplier: int
    best_multiplier: int


class LineOut(BaseModel):
    """Every lyric line of the game. Lines that carry a question have no text: it would give the answer away."""
    line_id: int
    sequence: int
    audio_start: float | None
    audio_end: float | None
    text: str | None


class GameOut(BaseModel):
    public_id: str
    song_id: int
    song_title: str
    song_artist: str
    song_duration: float
    sample_rate: int | None  # of the audio file; lets the browser open its audio context at the same rate
    language: str
    difficulty: str
    synced: bool  # False → free-play mode, no playback gating
    lyrics_offset: float  # seconds; applied once on the frontend when mapping lyric time to audio time
    started_at: datetime
    finished_at: datetime | None
    progress: ProgressOut
    questions: list[QuestionOut]
    lines: list[LineOut]


class GameSummary(BaseModel):
    public_id: str
    song_id: int
    difficulty: str
    started_at: datetime
    finished_at: datetime | None
    score: int  # points
    correct_count: int
    best_multiplier: int
    answered: int
    total: int


class GameCreate(BaseModel):
    song_id: int
    difficulty: str = Field("medium", max_length=16)


class AnswerIn(BaseModel):
    question_id: int
    option_id: int
    position: float | None = Field(None, ge=0, le=100_000)  # audio time (s) when the player answered; None = unknown
    waited: float = Field(0, ge=0, le=100_000)  # seconds the game spent waiting for this answer (multiplier decay)


class AnswerResult(BaseModel):
    correct: bool
    correct_option_id: int
    text: str  # the full line, now revealed
    score: int  # the game's points so far
    points: int  # points this answer earned
    ahead: bool
    multiplier: int  # the multiplier this answer was scored with
    streak: int
    next_multiplier: int
    already_answered: bool = False
    finished: bool = False
