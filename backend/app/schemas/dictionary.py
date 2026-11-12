from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ExampleOut(BaseModel):
    id: int
    song_id: int | None  # None: a sentence typed by hand
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
    pos: str | None = None  # noun | verb | adj | adv | pron | num | det | prep | conj | part | intj | other
    zipf: float | None = None
    source: str | None = None  # game | tap | manual | import
    meaning_edited: bool = False  # written by the user: a look-up asks before replacing it
    enrich_status: str  # pending | done | failed
    suspended: bool
    has_audio: bool = False  # a recording came with an imported deck: GET /api/dictionary/{id}/audio
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
    languages: list[LanguageCount]  # every language of the user, counted by the chosen status + search
    status_counts: dict[str, int]  # all / due / new / suspended, counted by the chosen language + search


class EntryPatch(BaseModel):
    """Only the fields sent change. The text fields come back as the user wrote them; an empty text clears the field."""

    suspended: bool | None = None
    translation: str | None = Field(None, max_length=300)
    lemma: str | None = Field(None, max_length=100)
    article: str | None = Field(None, max_length=16)
    pos: str | None = Field(None, max_length=16)


class WordLookup(BaseModel):
    """The word card: what is known about a tapped word."""

    word: str
    headword: str  # article + lemma (or the word itself)
    lemma: str | None
    article: str | None
    pos: str | None
    translation: str | None
    translation_language: str | None
    sentence: str
    sentence_translation: str | None
    entry_id: int | None  # the card, when the word is in the dictionary already
    offline: bool  # the services could not be reached: the word came back alone


class EntryAdd(BaseModel):
    """A word the user picks: tapped in a game (song_id + line) or typed into "+ Add word" (translation and example are optional)."""

    language: str = Field(min_length=2, max_length=16)
    word: str = Field(min_length=1, max_length=100)
    song_id: int | None = None
    line: str | None = Field(None, max_length=1000)  # the sung line the word was tapped in
    source: Literal["tap", "manual"] = "tap"
    translation: str | None = Field(None, max_length=300)
    example: str | None = Field(None, max_length=1000)


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
    has_audio: bool = False  # a recording came with an imported deck
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
    dictionary_mode: Literal["auto", "manual"] | None = None


class DeckImportResult(BaseModel):
    added: int
    existing: int  # words the dictionary already had
    skipped: int  # notes with nothing usable (empty, too long, repeated in the file)
