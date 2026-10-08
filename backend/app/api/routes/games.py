from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import current_user, get_song
from app.db.database import get_session
from app.db.models import Game, Song, User
from app.schemas.game import AnswerIn, AnswerResult, GameCreate, GameOut, GameSummary
from app.services.game import play

router = APIRouter(prefix="/api", tags=["games"], dependencies=[Depends(current_user)])


@router.post("/games", response_model=GameOut, status_code=201)
def create_game(body: GameCreate, session: Session = Depends(get_session), user: User = Depends(current_user)):
    song = get_song(body.song_id, session)
    return play.game_out(session, play.create_game(session, song, body.difficulty, user))


@router.get("/games/{public_id}", response_model=GameOut)
def read_game(public_id: str, session: Session = Depends(get_session), user: User = Depends(current_user)):
    return play.game_out(session, play.get_game(session, public_id, user))


@router.post("/games/{public_id}/answers", response_model=AnswerResult)
def answer(public_id: str, body: AnswerIn, session: Session = Depends(get_session), user: User = Depends(current_user)):
    game = play.get_game(session, public_id, user)
    return play.submit_answer(session, game, body.question_id, body.option_id, body.position, body.waited)


@router.get("/songs/{song_id}/games", response_model=list[GameSummary])
def song_games(song: Song = Depends(get_song), session: Session = Depends(get_session), user: User = Depends(current_user)):
    games = session.query(Game).filter_by(song_id=song.id, user_id=user.id).order_by(Game.id.desc()).limit(20).all()
    return [play.summary(session, g) for g in games]


@router.get("/games", response_model=list[GameSummary])
def my_games(session: Session = Depends(get_session), user: User = Depends(current_user)):
    """The user's games, newest first (the library's 'continue' card uses the unfinished ones)."""
    games = session.query(Game).filter_by(user_id=user.id).order_by(Game.id.desc()).limit(50).all()
    return [play.summary(session, g) for g in games]
