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
    finished_at: datetime
    me: bool


class GlobalScoreRow(BaseModel):
    rank: int
    display_name: str
    points: int  # the sum of the account's best score on every song
    songs: int
    me: bool
