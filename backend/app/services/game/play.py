from datetime import datetime

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import Game, GameAnswer, LyricLine, Lyrics, Question, Song
from app.db.models.types import utcnow
from app.schemas.game import (
    AnswerOut, AnswerResult, GameOut, GameSummary, OptionOut, ProgressOut, QuestionOut,
)
from app.services.game.generator import ensure_questions


def active_lyrics(session: Session, song: Song) -> Lyrics:
    lyrics = session.query(Lyrics).filter_by(song_id=song.id, is_active=True).order_by(Lyrics.id.desc()).first()
    if lyrics is None:
        raise AppError("no_lyrics", "This song has no lyrics yet; find or upload lyrics first", 409)
    return lyrics


def create_game(session: Session, song: Song, difficulty: str) -> Game:
    lyrics = active_lyrics(session, song)
    ensure_questions(session, song, lyrics, difficulty)
    game = Game(song_id=song.id, lyrics_id=lyrics.id, language=song.language, difficulty=difficulty)
    session.add(game)
    session.commit()
    return game


def get_game(session: Session, public_id: str) -> Game:
    game = session.query(Game).filter_by(public_id=public_id).one_or_none()
    if game is None:
        raise AppError("game_not_found", "Game not found", 404)
    return game


def _questions(session: Session, game: Game) -> list[Question]:
    return (
        session.query(Question).filter_by(lyrics_id=game.lyrics_id, difficulty=game.difficulty)
        .order_by(Question.lyric_line_id, Question.blank_index).all()
    )


def game_out(session: Session, game: Game) -> GameOut:
    song = session.get(Song, game.song_id)
    lyrics = session.get(Lyrics, game.lyrics_id)
    ordered = session.query(LyricLine).filter_by(lyrics_id=game.lyrics_id).order_by(LyricLine.sequence).all()
    lines = {l.id: l for l in ordered}
    # recovery position = start of the previous lyric line (not necessarily a question line)
    recovery = {l.id: (ordered[i - 1] if i > 0 else l).start_time for i, l in enumerate(ordered)}
    answers = {a.question_id: a for a in game.answers}
    questions = []
    for i, q in enumerate(_questions(session, game)):
        a = answers.get(q.id)
        correct = next(o.id for o in q.options if o.is_correct)
        questions.append(QuestionOut(
            id=q.id, line_id=q.lyric_line_id, blank_index=q.blank_index, sequence=i, audio_start=q.audio_start, audio_end=q.audio_end,
            recovery_start=recovery[q.lyric_line_id],
            question_text=q.sentence, text=lines[q.lyric_line_id].text if a else None,
            options=[OptionOut(id=o.id, text=o.text) for o in q.options],
            answer=AnswerOut(selected_option_id=a.selected_option_id, correct=a.is_correct,
                             correct_option_id=correct, answered_at=a.answered_at) if a else None,
        ))
    return GameOut(
        public_id=game.public_id, song_id=game.song_id, song_title=song.title, song_artist=song.artist, song_duration=song.duration,
        language=game.language, difficulty=game.difficulty,
        synced=lyrics.is_synced, lyrics_offset=song.lyrics_offset, started_at=game.started_at,
        finished_at=game.finished_at,
        progress=ProgressOut(answered=len(answers), total=len(questions), score=game.score),
        questions=questions,
    )


def summary(game: Game) -> GameSummary:
    return GameSummary(public_id=game.public_id, song_id=game.song_id, difficulty=game.difficulty,
                       started_at=game.started_at, finished_at=game.finished_at, score=game.score)


def submit_answer(session: Session, game: Game, question_id: int, option_id: int) -> AnswerResult:
    q = session.get(Question, question_id)
    if q is None or q.lyrics_id != game.lyrics_id or q.difficulty != game.difficulty:
        raise AppError("question_not_in_game", "This question does not belong to the game", 404)
    option = next((o for o in q.options if o.id == option_id), None)
    if option is None:
        raise AppError("invalid_option", "This option does not belong to the question", 422)
    correct_id = next(o.id for o in q.options if o.is_correct)
    text = session.get(LyricLine, q.lyric_line_id).text

    existing = next((a for a in game.answers if a.question_id == q.id), None)
    if existing is not None:  # idempotent: the first answer stands
        return AnswerResult(correct=existing.is_correct, correct_option_id=correct_id, text=text,
                            score=game.score, already_answered=True, finished=game.finished_at is not None)
    session.add(GameAnswer(game_id=game.id, question_id=q.id, selected_option_id=option.id, is_correct=option.is_correct))
    if option.is_correct:
        game.score += 1
    session.flush()
    total = len(_questions(session, game))
    answered = session.query(GameAnswer).filter_by(game_id=game.id).count()
    if answered >= total and game.finished_at is None:
        game.finished_at = utcnow()
    session.commit()
    return AnswerResult(correct=option.is_correct, correct_option_id=correct_id, text=text, score=game.score,
                        finished=game.finished_at is not None)
