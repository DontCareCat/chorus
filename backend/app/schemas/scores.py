from datetime import datetime

from pydantic import BaseModel


class SongScoreRow(BaseModel):
    rank: int
    display_name: str
    points: int
    correct: int
    total: int
    best_multiplier: int
    difficulty: str
    mode: str = "choice"
    finished_at: datetime
    me: bool


class GlobalScoreRow(BaseModel):
    rank: int
    display_name: str
    points: int  # the sum of the account's best score on every song
    songs: int
    me: bool


class SongBoard(BaseModel):
    """The top of a song's board, the caller's own row when it is below the top, and how many players the board has."""

    rows: list[SongScoreRow]
    me: SongScoreRow | None = None
    players: int


class GlobalBoard(BaseModel):
    rows: list[GlobalScoreRow]
    me: GlobalScoreRow | None = None
    players: int


class MyScoreRow(BaseModel):
    """One song the caller finished, with their best points and their place among the song's players."""

    song_id: int
    title: str
    artist: str
    has_cover: bool | None
    youtube_id: str | None
    removed: bool
    points: int
    rank: int
    players: int
    last_finished_at: datetime


class MyOverall(BaseModel):
    points: int
    rank: int
    players: int
    songs: int


class MyScores(BaseModel):
    songs: list[MyScoreRow]
    overall: MyOverall | None = None  # None until the caller finished a game in this mode
