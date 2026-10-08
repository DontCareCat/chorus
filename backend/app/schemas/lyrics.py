from pydantic import BaseModel

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
