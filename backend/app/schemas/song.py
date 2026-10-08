from pydantic import BaseModel, ConfigDict, Field

from app.db.models import LyricsStatus, SongSource


class SongOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    artist: str
    album: str | None
    duration: float
    language: str
    lyrics_offset: float
    source: SongSource
    file_name: str
    available: bool
    has_cover: bool | None  # None = not checked yet; the cover endpoint answers 404 if there is none
    lyrics_status: LyricsStatus


class SongPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    artist: str | None = Field(None, max_length=300)
    album: str | None = Field(None, max_length=300)
    language: str | None = Field(None, min_length=2, max_length=16)
    lyrics_offset: float | None = Field(None, ge=-60, le=60)


class ImportRequest(BaseModel):
    path: str


class ImportTreeRequest(BaseModel):
    path: str
    recursive: bool = True  # include subfolders
    copy_files: bool = False  # copy files into the app's storage instead of using them where they are


class ScanOut(BaseModel):
    added: int
    skipped: int
    unavailable: int
    errors: list[str]
