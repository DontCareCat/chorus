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
    next_due_at: datetime | None  # when there is no card now: the earliest later one
    summary: ReviewSummary


class RatingIn(BaseModel):
    rating: Literal["again", "hard", "good", "easy"]


class ImportResult(BaseModel):
    added: int
    words: int


class LanguagePatch(BaseModel):
    translation_language: str = Field(min_length=2, max_length=16)
