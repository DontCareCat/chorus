from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ExampleOut(BaseModel):
    id: int
    song_id: int
    song_title: str
    sentence: str
    translation: str | None
    audio_start: float | None  # in the audio file (the song's timing offset is already added)
    audio_end: float | None
    playable: bool  # the song file is there and the line has timing


class EntryOut(BaseModel):
    id: int
    language: str
    surface: str
    lemma: str | None
    article: str | None
    translation: str | None
    translation_language: str | None
    enrich_status: str  # pending | done | failed
    suspended: bool
    added_at: datetime
    due_at: datetime | None
    interval_seconds: int
    reps: int
    lapses: int
    examples: list[ExampleOut]


class ScheduleState(BaseModel):
    """A card's review schedule: what a rating changes, and what an undo puts back."""

    due_at: datetime | None
    interval_seconds: int = Field(ge=0, le=366 * 86400)
    reps: int = Field(ge=0, le=100000)
    lapses: int = Field(ge=0, le=100000)
    introduced_at: datetime | None
    last_reviewed_at: datetime | None


class RatedOut(EntryOut):
    previous: ScheduleState  # the schedule before this rating, for "Back"


class LanguageCount(BaseModel):
    code: str
    count: int


class EntryList(BaseModel):
    total: int
    items: list[EntryOut]
    languages: list[LanguageCount]


class EntryPatch(BaseModel):
    suspended: bool


class ReviewSummary(BaseModel):
    due: int
    new: int
    total: int
    available: int  # words that can be reviewed (not paused)
    reviewed_today: int
    left_today: int | None  # cards the daily limit still allows; None = no limit


class Intervals(BaseModel):
    again: int
    hard: int
    good: int
    easy: int


class ReviewFront(BaseModel):
    id: int
    word: str  # as it was sung: no article, no translation
    language: str
    intervals: Intervals  # seconds each button would set


class ReviewNext(BaseModel):
    card: ReviewFront | None
    summary: ReviewSummary


class RatingIn(BaseModel):
    rating: Literal["again", "hard", "good", "easy"]


class ImportResult(BaseModel):
    added: int
    words: int


class AccountPatch(BaseModel):
    translation_language: str | None = Field(None, min_length=2, max_length=16)
    daily_card_limit: int | None = Field(None, ge=0, le=1000)
