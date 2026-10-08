import enum
from datetime import datetime

from sqlalchemy import Integer, Boolean, Enum, Float, String
from sqlalchemy import false as sa_false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.db.models.types import UTCDateTime, utcnow


class SongSource(str, enum.Enum):
    library = "library"  # discovered folder, used in place
    import_ = "import"  # copied from a server path into MEDIA_DIR
    upload = "upload"  # uploaded from the browser


class LyricsStatus(str, enum.Enum):
    pending = "pending"
    found = "found"
    needs_choice = "needs_choice"
    not_found = "not_found"


class Song(Base):
    __tablename__ = "songs"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    artist: Mapped[str] = mapped_column(String(300), default="")
    album: Mapped[str | None] = mapped_column(String(300), default=None)
    duration: Mapped[float] = mapped_column(Float)
    sample_rate: Mapped[int | None] = mapped_column(Integer, default=None)  # Hz; the player matches its audio context to it
    language: Mapped[str] = mapped_column(String(16))  # language of the lyrics = language being learned
    lyrics_offset: Mapped[float] = mapped_column(Float, default=0.0)  # user timing correction, seconds
    source: Mapped[SongSource] = mapped_column(Enum(SongSource, native_enum=False, length=16))
    file_path: Mapped[str] = mapped_column(String(1000))
    file_name: Mapped[str] = mapped_column(String(300))
    available: Mapped[bool] = mapped_column(Boolean, default=True)
    removed: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa_false())  # hidden library song
    has_cover: Mapped[bool | None] = mapped_column(Boolean, default=None)  # None = not checked yet
    lyrics_status: Mapped[LyricsStatus] = mapped_column(
        Enum(LyricsStatus, native_enum=False, length=16), default=LyricsStatus.pending
    )
    content_hash: Mapped[str] = mapped_column(String(64), unique=True)  # SHA-256 of the audio file
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    lyrics: Mapped[list["Lyrics"]] = relationship(back_populates="song")  # noqa: F821
