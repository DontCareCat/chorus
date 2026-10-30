from datetime import datetime

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
    file_name: str | None
    youtube_id: str | None = None
    youtube_channel: str | None = None
    available: bool
    has_cover: bool | None  # None = not checked yet; the cover endpoint answers 404 if there is none
    cover_source: str | None = None  # embedded | online | custom | choose (candidates to pick from) | none
    lyrics_status: LyricsStatus
    created_at: datetime
    best_score: int | None = None  # the signed-in user's own finished games (list endpoint only)
    plays: int = 0
    last_played_at: datetime | None = None
    lyrics_stalled: bool = False  # still pending past the configured timeout (set by the list endpoint)


class SongPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    artist: str | None = Field(None, max_length=300)
    album: str | None = Field(None, max_length=300)
    language: str | None = Field(None, min_length=2, max_length=16)
    lyrics_offset: float | None = Field(None, ge=-60, le=60)
    duration: float | None = Field(None, gt=0, le=86_400)  # only for a YouTube song: the player tells its length


class YouTubeRequest(BaseModel):
    url: str = Field(min_length=1, max_length=500)  # a watch / shorts / youtu.be link or the video id
    title: str | None = Field(None, min_length=1, max_length=300)
    artist: str | None = Field(None, max_length=300)


class YouTubePreviewOut(BaseModel):
    """What a YouTube link would add: nothing is saved by asking."""
    video_id: str
    title: str
    artist: str
    channel: str
    existing_id: int | None = None  # the song already in the library (a removed one does not count)
    existing_title: str | None = None


class YouTubeImportRequest(BaseModel):
    video_ids: list[str] = Field(min_length=1, max_length=25)  # a batch of a playlist's videos
    lookup: bool = True  # look for lyrics at once; a playlist import turns it off and asks once for all the songs at the end


class YouTubeImportFailure(BaseModel):
    video_id: str
    reason: str  # video_unavailable | not_a_video


class YouTubeImportOut(BaseModel):
    songs: list[SongOut]  # added and already-present songs, in the order asked
    added: int
    existing: int
    failed: list[YouTubeImportFailure]
    not_tried: list[str]  # YouTube could not be reached: these were not looked at


class RetryRequest(BaseModel):
    ids: list[int] | None = Field(None, max_length=100_000)


class RetryOut(BaseModel):
    queued: int


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


class TrackIn(BaseModel):
    title: str = Field(max_length=300)
    artist: str = Field("", max_length=300)
    duration: float = Field(0, ge=0, le=86_400)


class TrackMatchRequest(BaseModel):
    tracks: list[TrackIn] = Field(min_length=1, max_length=2000)


class TrackMatch(BaseModel):
    index: int
    song_id: int
    song_title: str


class TrackMatchOut(BaseModel):
    matches: list[TrackMatch]
