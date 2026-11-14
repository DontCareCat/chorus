from datetime import datetime

from pydantic import BaseModel, Field

from app.db.models import LyricsStatus


class CandidateOut(BaseModel):
    id: int
    artist: str
    title: str
    album: str | None
    duration: float
    synced: bool
    has_plain: bool
    instrumental: bool
    usable: bool  # false → plain-only while unsynchronized lyrics are not allowed, or instrumental
    in_use: bool = False  # these are the lyrics the song has right now


class LineOut(BaseModel):
    sequence: int
    start_time: float | None
    end_time: float | None
    text: str


class LyricsOut(BaseModel):
    id: int
    source: str
    external_id: str | None
    is_synced: bool
    lines: list[LineOut]
    warnings: list[str] = []


class DiscoveryOut(BaseModel):
    status: LyricsStatus
    lyrics: LyricsOut | None = None
    candidates: list[CandidateOut] = []
    unsynced_hidden: int = 0
    warnings: list[str] = []
    error: str | None = None


class AttachRequest(BaseModel):
    lrclib_id: int


class TimingLineOut(BaseModel):
    text: str
    time: float | None  # effective start incl. the song's offset; None = no time yet
    original: float | None  # the time the lyrics came with


class TimingOut(BaseModel):
    lines: list[TimingLineOut]
    duration: float
    edited: bool
    edited_at: datetime | None = None
    synced: bool  # the lyrics came with timing (False: plain lyrics the editor can time)


class TimingIn(BaseModel):
    times: list[float | None] = Field(max_length=5000)  # one per line, in order; never any text
