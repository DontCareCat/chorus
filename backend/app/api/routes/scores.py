from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import current_user, get_song
from app.db.database import get_session
from app.db.models import Song, User
from app.schemas.scores import GlobalScoreRow, SongScoreRow
from app.services.game import scores

router = APIRouter(prefix="/api", tags=["scores"], dependencies=[Depends(current_user)])


@router.get("/scores", response_model=list[GlobalScoreRow])
def global_board(session: Session = Depends(get_session), me: User = Depends(current_user)):
    return scores.global_scores(session, me)


@router.get("/songs/{song_id}/scores", response_model=list[SongScoreRow])
def song_board(song: Song = Depends(get_song), session: Session = Depends(get_session), me: User = Depends(current_user)):
    return scores.song_scores(session, song.id, me)
