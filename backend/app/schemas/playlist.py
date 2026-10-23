from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.song import SongOut


class PlaylistCover(BaseModel):
    id: int
    title: str
    has_cover: bool | None


class PlaylistSummary(BaseModel):
    id: int
    name: str
    song_count: int
    duration: float  # seconds, of the songs still in the library
    covers: list[PlaylistCover]  # the first four songs, for the collage
    song_ids: list[int]  # lets the "Add to playlist" list tick the ones that already hold a song
    updated_at: datetime


class PlaylistSongOut(SongOut):
    removed: bool = False  # taken out of the library: kept in the list, greyed, not playable


class PlaylistOut(BaseModel):
    id: int
    name: str
    song_count: int
    duration: float
    songs: list[PlaylistSongOut]


class PlaylistIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class SongIds(BaseModel):
    song_ids: list[int] = Field(min_length=1, max_length=5000)
