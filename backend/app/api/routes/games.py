from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_song
from app.db.database import get_session
from app.db.models import Game, Song
from app.schemas.game import AnswerIn, AnswerResult, GameCreate, GameOut, GameSummary
from app.services.game import play

router = APIRouter(prefix="/api", tags=["games"])


@router.post("/games", response_model=GameOut, status_code=201)
def create_game(body: GameCreate, session: Session = Depends(get_session)):
    song = get_song(body.song_id, session)
    return play.game_out(session, play.create_game(session, song, body.difficulty))


@router.get("/games/{public_id}", response_model=GameOut)
def read_game(public_id: str, session: Session = Depends(get_session)):
    return play.game_out(session, play.get_game(session, public_id))


@router.post("/games/{public_id}/answers", response_model=AnswerResult)
def answer(public_id: str, body: AnswerIn, session: Session = Depends(get_session)):
    return play.submit_answer(session, play.get_game(session, public_id), body.question_id, body.option_id)


@router.get("/songs/{song_id}/games", response_model=list[GameSummary])
def song_games(song: Song = Depends(get_song), session: Session = Depends(get_session)):
    games = session.query(Game).filter_by(song_id=song.id).order_by(Game.id.desc()).limit(20).all()
    return [play.summary(g) for g in games]
