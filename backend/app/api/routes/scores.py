from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import current_user, get_song
from app.db.database import get_session
from app.db.models import Song, User
from app.schemas.scores import GlobalBoard, GlobalScoreRow, MyScores, SongBoard, SongScoreRow
from app.services.game import scores

router = APIRouter(prefix="/api", tags=["scores"], dependencies=[Depends(current_user)])


@router.get("/scores", response_model=GlobalBoard | list[GlobalScoreRow])
def global_board(mode: Literal["choice", "typing"] = "choice", limit: int | None = Query(None, ge=1, le=50), session: Session = Depends(get_session), me: User = Depends(current_user)):
    """The overall board. With `limit`: {rows (the top), me (the caller's row when it is below the top), players}; without: the plain list of up to 50 rows."""
    if limit is not None:
        return scores.global_board(session, me, mode, limit)
    return scores.global_scores(session, me, mode)


@router.get("/scores/mine", response_model=MyScores)
def my_scores(mode: Literal["choice", "typing"] = "choice", session: Session = Depends(get_session), me: User = Depends(current_user)):
    """The songs the caller finished in this mode, newest first, with their best points and place; and their overall total and place."""
    return scores.my_scores(session, me, mode)


@router.get("/songs/{song_id}/scores", response_model=SongBoard | list[SongScoreRow])
def song_board(mode: Literal["choice", "typing"] = "choice", limit: int | None = Query(None, ge=1, le=50), song: Song = Depends(get_song), session: Session = Depends(get_session), me: User = Depends(current_user)):
    """A song's board. With `limit`: {rows (the top), me (the caller's row when it is below the top), players}; without: the plain list of up to 50 rows."""
    if limit is not None:
        return scores.song_board(session, song.id, me, mode, limit)
    return scores.song_scores(session, song.id, me, mode)
