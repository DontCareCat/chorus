from datetime import datetime

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.db.models.types import UTCDateTime, utcnow


class DictionaryEntry(Base):
    """A word one user was asked in a game, with what is known about it and where it is in the review schedule."""

    __tablename__ = "dictionary_entries"
    __table_args__ = (UniqueConstraint("user_id", "language", "word", name="uq_dictionary_word"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    language: Mapped[str] = mapped_column(String(16))  # language of the song the word comes from
    word: Mapped[str] = mapped_column(String(100))  # casefolded: the key
    surface: Mapped[str] = mapped_column(String(100))  # as it was sung
    lemma: Mapped[str | None] = mapped_column(String(100), default=None)  # dictionary form, when Wiktionary says the word is an inflection
    article: Mapped[str | None] = mapped_column(String(16), default=None)  # der / die / das, le / la ...; None when unknown or none
    translation: Mapped[str | None] = mapped_column(String(300), default=None)
    translation_language: Mapped[str | None] = mapped_column(String(16), default=None)  # the language `translation` is in
    lookup_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # 1 = looked up with the parser of 2026-10-30; older ones are redone
    enrich_status: Mapped[str] = mapped_column(String(8), default="pending", server_default="pending")  # pending | done | failed
    suspended: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    added_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    # review schedule (services/dictionary/srs.py)
    due_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None, index=True)  # None = never reviewed
    interval_seconds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    reps: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    lapses: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    introduced_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)  # first review (the daily limit of new cards)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)

    examples: Mapped[list["DictionaryExample"]] = relationship(
        back_populates="entry", order_by="DictionaryExample.id", cascade="all, delete-orphan"
    )


class DictionaryExample(Base):
    """A song line the word appeared in. Text and timing are copied, so they outlive replaced lyrics."""

    __tablename__ = "dictionary_examples"

    id: Mapped[int] = mapped_column(primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("dictionary_entries.id", ondelete="CASCADE"), index=True)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id"), index=True)
    sentence: Mapped[str] = mapped_column(Text)
    translation: Mapped[str | None] = mapped_column(Text, default=None)
    audio_start: Mapped[float | None] = mapped_column(Float, default=None)  # lyric time; the song's offset is added when it is played
    audio_end: Mapped[float | None] = mapped_column(Float, default=None)

    entry: Mapped[DictionaryEntry] = relationship(back_populates="examples")


class DictionaryCache(Base):
    """Answers of the translation service and of Wiktionary (shared by all users: each text is sent out once)."""

    __tablename__ = "dictionary_cache"

    id: Mapped[int] = mapped_column(primary_key=True)
    cache_key: Mapped[str] = mapped_column(String(120), unique=True)
    payload: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
