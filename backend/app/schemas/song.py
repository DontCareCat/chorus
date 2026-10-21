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
    language_source: str = "default"  # default | detected (from the lyrics) | manual
    lyrics_offset: float
    source: SongSource
    file_name: str
    available: bool
    has_cover: bool | None  # None = not checked yet; the cover endpoint answers 404 if there is none
    cover_source: str | None = None  # embedded | online | custom | choose (candidates to pick from) | none
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
    include: str | None = None  # regular expression: only file names that match are imported
    exclude: str | None = None  # regular expression: file names that match are left out


class BulkDeleteRequest(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=5000)


class BulkDeleteOut(BaseModel):
    hidden: int
    deleted: int
    missing: int  # ids that no longer exist


class ImportManyRequest(BaseModel):
    paths: list[str] = Field(min_length=1, max_length=500)  # audio files and/or folders
    recursive: bool = True
    copy_files: bool = False
    include: str | None = None
    exclude: str | None = None


class ScanOut(BaseModel):
    added: int
    skipped: int
    unavailable: int
    filtered: int = 0
    errors: list[str]
