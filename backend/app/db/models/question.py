from datetime import datetime

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.db.models.types import UTCDateTime, utcnow


class Question(Base):
    __tablename__ = "questions"
    __table_args__ = (UniqueConstraint("lyrics_id", "difficulty", "lyric_line_id", "blank_index", name="uq_question_blank"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id"), index=True)
    lyrics_id: Mapped[int] = mapped_column(ForeignKey("lyrics.id"), index=True)
    lyric_line_id: Mapped[int] = mapped_column(ForeignKey("lyric_lines.id"), index=True)
    difficulty: Mapped[str] = mapped_column(String(16))
    blank_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # which blank of the line
    missing_word: Mapped[str] = mapped_column(String(100))
    sentence: Mapped[str] = mapped_column(Text)
    audio_start: Mapped[float | None] = mapped_column(Float, default=None)
    audio_end: Mapped[float | None] = mapped_column(Float, default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    options: Mapped[list["QuestionOption"]] = relationship(
        back_populates="question", order_by="QuestionOption.position", cascade="all, delete-orphan"
    )


class QuestionOption(Base):
    __tablename__ = "question_options"
    __table_args__ = (UniqueConstraint("question_id", "position"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), index=True)
    text: Mapped[str] = mapped_column(String(100))
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int]

    question: Mapped[Question] = relationship(back_populates="options")
