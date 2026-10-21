from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import current_user, get_session_factory, get_song, get_translator, get_wiktionary
from app.db.database import get_session
from app.db.models import Game, Question, Song, User
from app.schemas.game import AnswerIn, AnswerResult, GameCreate, GameOut, GameSummary
from app.services.dictionary import service as dictionary
from app.services.dictionary.lookup import Translator, Wiktionary
from app.services.game import play

router = APIRouter(prefix="/api", tags=["games"], dependencies=[Depends(current_user)])


@router.post("/games", response_model=GameOut, status_code=201)
def create_game(body: GameCreate, session: Session = Depends(get_session), user: User = Depends(current_user)):
    song = get_song(body.song_id, session)
    return play.game_out(session, play.create_game(session, song, body.difficulty, user, body.mode))


@router.get("/games/{public_id}", response_model=GameOut)
def read_game(public_id: str, session: Session = Depends(get_session), user: User = Depends(current_user)):
    return play.game_out(session, play.get_game(session, public_id, user))


@router.post("/games/{public_id}/answers", response_model=AnswerResult)
def answer(
    public_id: str, body: AnswerIn, background: BackgroundTasks, session: Session = Depends(get_session), user: User = Depends(current_user),
    factory: sessionmaker = Depends(get_session_factory), translator: Translator = Depends(get_translator),
    wiktionary: Wiktionary = Depends(get_wiktionary),
):
    game = play.get_game(session, public_id, user)
    result = play.submit_answer(session, game, body.question_id, body.option_id, body.position, body.waited, body.text)
    if not result.already_answered:  # the word goes into the dictionary; its article and translation follow in the background
        dictionary.record_asked(session, user.id, game.language, session.get(Question, body.question_id))
        background.add_task(dictionary.enrich_pending, factory, translator, wiktionary, user.id)
    return result


@router.get("/songs/{song_id}/games", response_model=list[GameSummary])
def song_games(song: Song = Depends(get_song), session: Session = Depends(get_session), user: User = Depends(current_user)):
    games = session.query(Game).filter_by(song_id=song.id, user_id=user.id).order_by(Game.id.desc()).limit(20).all()
    return [play.summary(session, g) for g in games]


@router.get("/games", response_model=list[GameSummary])
def my_games(session: Session = Depends(get_session), user: User = Depends(current_user)):
    """The user's games, newest first (the library's 'continue' card uses the unfinished ones)."""
    games = session.query(Game).filter_by(user_id=user.id).order_by(Game.id.desc()).limit(50).all()
    return [play.summary(session, g) for g in games]
