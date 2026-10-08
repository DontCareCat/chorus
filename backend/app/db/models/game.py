import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.db.models.types import UTCDateTime, utcnow


class Game(Base):
    __tablename__ = "games"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id"), index=True)
    lyrics_id: Mapped[int] = mapped_column(ForeignKey("lyrics.id"), index=True)
    language: Mapped[str] = mapped_column(String(16))
    difficulty: Mapped[str] = mapped_column(String(16))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    score: Mapped[int] = mapped_column(Integer, default=0)  # points (see services/game/scoring.py)
    correct_count: Mapped[int] = mapped_column(Integer, default=0)
    streak: Mapped[int] = mapped_column(Integer, default=0)  # consecutive correct answers, drives the multiplier
    multiplier: Mapped[int] = mapped_column(Integer, default=1)
    best_multiplier: Mapped[int] = mapped_column(Integer, default=1)

    answers: Mapped[list["GameAnswer"]] = relationship(back_populates="game", cascade="all, delete-orphan")


class GameAnswer(Base):
    __tablename__ = "game_answers"
    __table_args__ = (UniqueConstraint("game_id", "question_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), index=True)
    selected_option_id: Mapped[int] = mapped_column(ForeignKey("question_options.id"))
    is_correct: Mapped[bool] = mapped_column(Boolean)
    points: Mapped[int] = mapped_column(Integer, default=0)
    ahead: Mapped[bool] = mapped_column(Boolean, default=False)
    multiplier: Mapped[int] = mapped_column(Integer, default=1)  # multiplier this answer was scored with
    answered_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    game: Mapped[Game] = relationship(back_populates="answers")
