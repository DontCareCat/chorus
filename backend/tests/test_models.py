from datetime import timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.db.models import (
    Game, GameAnswer, LyricLine, Lyrics, LyricsSource, Question, QuestionOption, Song, SongSource,
)


def make_graph(session):
    song = Song(
        title="Du hast", artist="Rammstein", duration=235.0, language="de",
        source=SongSource.upload, file_path="/m/a.mp3", file_name="a.mp3", content_hash="a" * 64,
    )
    lyrics = Lyrics(song=song, source=LyricsSource.lrclib, external_id="123")
    line = LyricLine(lyrics=lyrics, sequence=0, start_time=31.13, end_time=38.86, text="Du hast mich gefragt")
    session.add_all([song, lyrics, line])
    session.flush()
    q = Question(
        song_id=song.id, lyrics_id=lyrics.id, lyric_line_id=line.id, difficulty="medium",
        missing_word="gefragt", sentence="Du hast mich ____", audio_start=31.13, audio_end=38.86,
    )
    q.options = [QuestionOption(text=t, is_correct=(i == 0), position=i) for i, t in enumerate(["gefragt", "gesagt", "gesehen", "gehört"])]
    session.add(q)
    session.commit()
    return song, lyrics, line, q


def test_roundtrip_and_float_precision(session):
    song, _, line, q = make_graph(session)
    session.expire_all()
    assert session.get(LyricLine, line.id).start_time == 31.13
    assert [o.position for o in session.get(Question, q.id).options] == [0, 1, 2, 3]
    assert song.created_at.tzinfo == timezone.utc
    assert song.lyrics_offset == 0.0


def test_duplicate_file_hash_rejected(session):
    make_graph(session)
    session.add(Song(title="Dup", duration=1, language="de", source=SongSource.upload, file_path="/m/b.mp3", file_name="b.mp3", content_hash="a" * 64))
    with pytest.raises(IntegrityError):
        session.commit()


def test_duplicate_line_sequence_rejected(session):
    _, lyrics, _, _ = make_graph(session)
    session.add(LyricLine(lyrics_id=lyrics.id, sequence=0, start_time=50, end_time=51, text="x"))
    with pytest.raises(IntegrityError):
        session.commit()


def test_one_answer_per_question_per_game(session):
    song, lyrics, _, q = make_graph(session)
    game = Game(song_id=song.id, lyrics_id=lyrics.id, language="de", difficulty="medium")
    session.add(game)
    session.flush()
    assert len(game.public_id) == 36
    opt = q.options[0]
    session.add(GameAnswer(game_id=game.id, question_id=q.id, selected_option_id=opt.id, is_correct=True))
    session.commit()
    session.add(GameAnswer(game_id=game.id, question_id=q.id, selected_option_id=opt.id, is_correct=True))
    with pytest.raises(IntegrityError):
        session.commit()
