import enum
from datetime import datetime

from sqlalchemy import Boolean, Enum, Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.db.models.song import Song
from app.db.models.types import UTCDateTime, utcnow


class LyricsSource(str, enum.Enum):
    lrclib = "lrclib"
    sidecar = "sidecar"
    upload = "upload"


class Lyrics(Base):
    __tablename__ = "lyrics"
    id: Mapped[int] = mapped_column(primary_key=True)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id"), index=True)
    source: Mapped[LyricsSource] = mapped_column(Enum(LyricsSource, native_enum=False, length=16))
    external_id: Mapped[str | None] = mapped_column(String(64), default=None)  # LRCLIB id
    is_synced: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)  # newest attached lyrics; old rows kept for old games
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    song: Mapped[Song] = relationship(back_populates="lyrics")
    lines: Mapped[list["LyricLine"]] = relationship(
        back_populates="lyrics", order_by="LyricLine.sequence", cascade="all, delete-orphan"
    )


class LyricLine(Base):
    __tablename__ = "lyric_lines"
    __table_args__ = (UniqueConstraint("lyrics_id", "sequence"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    lyrics_id: Mapped[int] = mapped_column(ForeignKey("lyrics.id"), index=True)
    sequence: Mapped[int]
    start_time: Mapped[float | None] = mapped_column(Float, default=None)  # NULL = unsynced lyrics
    end_time: Mapped[float | None] = mapped_column(Float, default=None)
    text: Mapped[str] = mapped_column(Text)

    lyrics: Mapped[Lyrics] = relationship(back_populates="lines")


class LyricsCache(Base):
    """Raw LRCLIB responses (including empty results), keyed by normalised query."""

    __tablename__ = "lyrics_cache"

    id: Mapped[int] = mapped_column(primary_key=True)
    cache_key: Mapped[str] = mapped_column(String(300), unique=True)
    payload: Mapped[str] = mapped_column(Text)  # JSON
    fetched_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
