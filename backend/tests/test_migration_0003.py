"""The accounts/scoring migration on a database that already holds games (the user's real data)."""
import sqlalchemy as sa
from alembic import command

from app.core.config import settings
from app.db.migrate import alembic_config


def test_existing_games_go_to_the_guest_and_scores_become_points(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'old.db').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    config = alembic_config()
    command.upgrade(config, "0002")
    engine = sa.create_engine(url)
    with engine.begin() as c:
        c.execute(sa.text("INSERT INTO songs (id, source, file_path, file_name, content_hash, title, artist, duration, language, "
                          "available, lyrics_offset, lyrics_status, removed, created_at) "
                          "VALUES (1,'upload','/x.wav','x.wav','h','T','A',10,'de',1,0,'found',0,'2026-01-01')"))
        c.execute(sa.text("INSERT INTO lyrics (id, song_id, source, is_synced, is_active, created_at) VALUES (1,1,'upload',1,1,'2026-01-01')"))
        c.execute(sa.text("INSERT INTO games (id, public_id, song_id, lyrics_id, language, difficulty, started_at, score) "
                          "VALUES (1,'g1',1,1,'de','easy','2026-01-01',9)"))
    command.upgrade(config, "head")
    with engine.connect() as c:
        guest = c.execute(sa.text("SELECT id, is_guest, password_hash FROM users")).one()
        game = c.execute(sa.text("SELECT user_id, score, correct_count, streak, multiplier, best_multiplier FROM games")).one()
        assert (guest.is_guest, guest.password_hash) == (1, None)
        assert tuple(game) == (guest.id, 90, 9, 0, 1, 1)
    command.downgrade(config, "0002")
    with engine.connect() as c:
        assert c.execute(sa.text("SELECT score FROM games")).scalar_one() == 9
    command.upgrade(config, "head")  # and up again


def test_models_match_the_migrations(tmp_path, monkeypatch):
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    from app.db.database import Base

    url = f"sqlite:///{(tmp_path / 'new.db').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    command.upgrade(alembic_config(), "head")
    with sa.create_engine(url).connect() as c:
        diff = compare_metadata(MigrationContext.configure(c, opts={"render_as_batch": True}), Base.metadata)
    assert diff == []


def test_0004_keeps_existing_games_on_their_version_1_questions(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'v.db').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    config = alembic_config()
    command.upgrade(config, "0003")
    engine = sa.create_engine(url)
    with engine.begin() as c:
        c.execute(sa.text("INSERT INTO songs (id, source, file_path, file_name, content_hash, title, artist, duration, language, "
                          "available, lyrics_offset, lyrics_status, removed, created_at) "
                          "VALUES (1,'upload','/x.wav','x.wav','h','T','A',10,'de',1,0,'found',0,'2026-01-01')"))
        c.execute(sa.text("INSERT INTO lyrics (id, song_id, source, is_synced, is_active, created_at) VALUES (1,1,'upload',1,1,'2026-01-01')"))
        c.execute(sa.text("INSERT INTO lyric_lines (id, lyrics_id, sequence, text, start_time, end_time) VALUES (1,1,0,'a b c',0,1)"))
        c.execute(sa.text("INSERT INTO questions (id, song_id, lyrics_id, lyric_line_id, difficulty, blank_index, missing_word, sentence, created_at) "
                          "VALUES (1,1,1,1,'easy',0,'a','____ b c','2026-01-01')"))
        c.execute(sa.text("INSERT INTO games (id, public_id, user_id, song_id, lyrics_id, language, difficulty, started_at, score, correct_count, streak, multiplier, best_multiplier) "
                          "VALUES (1,'g1',1,1,1,'de','easy','2026-01-01',0,0,0,1,1)"))
    command.upgrade(config, "head")
    with engine.connect() as c:
        assert c.execute(sa.text("SELECT version FROM questions")).scalar_one() == 1
        assert c.execute(sa.text("SELECT question_version FROM games")).scalar_one() == 1
    with engine.begin() as c:  # a version 2 set can now sit beside it
        c.execute(sa.text("INSERT INTO questions (id, song_id, lyrics_id, lyric_line_id, difficulty, version, blank_index, missing_word, sentence, created_at) "
                          "VALUES (2,1,1,1,'easy',2,0,'a','____ b c','2026-01-01')"))
    command.downgrade(config, "0003")
    with engine.connect() as c:
        assert c.execute(sa.text("SELECT count(*) FROM questions")).scalar_one() == 1  # only the old set can exist there
    command.upgrade(config, "head")


def test_0006_adds_the_typing_mode_and_cover_columns_and_keeps_answers(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'v6.db').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    config = alembic_config()
    command.upgrade(config, "0005")
    engine = sa.create_engine(url)
    with engine.begin() as c:
        c.execute(sa.text("INSERT INTO songs (id, source, file_path, file_name, content_hash, title, artist, duration, language, "
                          "available, lyrics_offset, lyrics_status, removed, created_at) "
                          "VALUES (1,'upload','/x.wav','x.wav','h','T','A',10,'de',1,0,'found',0,'2026-01-01')"))
        c.execute(sa.text("INSERT INTO lyrics (id, song_id, source, is_synced, is_active, created_at) VALUES (1,1,'upload',1,1,'2026-01-01')"))
        c.execute(sa.text("INSERT INTO lyric_lines (id, lyrics_id, sequence, text, start_time, end_time) VALUES (1,1,0,'a b c',0,1)"))
        c.execute(sa.text("INSERT INTO questions (id, song_id, lyrics_id, lyric_line_id, difficulty, version, blank_index, missing_word, sentence, created_at) "
                          "VALUES (1,1,1,1,'easy',2,0,'a','____ b c','2026-01-01')"))
        c.execute(sa.text("INSERT INTO question_options (id, question_id, text, is_correct, position) VALUES (1,1,'a',1,0)"))
        c.execute(sa.text("INSERT INTO games (id, public_id, user_id, song_id, lyrics_id, language, difficulty, started_at, score, correct_count, streak, multiplier, best_multiplier, question_version) "
                          "VALUES (1,'g1',1,1,1,'de','easy','2026-01-01',10,1,1,1,1,2)"))
        c.execute(sa.text("INSERT INTO game_answers (id, game_id, question_id, selected_option_id, is_correct, answered_at, points, ahead, multiplier) "
                          "VALUES (1,1,1,1,1,'2026-01-01',10,0,1)"))
    command.upgrade(config, "head")
    with engine.begin() as c:
        assert c.execute(sa.text("SELECT mode FROM games")).scalar_one() == "choice"
        assert c.execute(sa.text("SELECT selected_option_id, typed_text, match FROM game_answers")).one() == (1, None, None)
        assert c.execute(sa.text("SELECT cover_source, cover_file FROM songs")).one() == (None, None)
        c.execute(sa.text("INSERT INTO games (id, public_id, user_id, song_id, lyrics_id, language, difficulty, mode, started_at, score, correct_count, streak, multiplier, best_multiplier, question_version) "
                          "VALUES (2,'g2',1,1,1,'de','easy','typing','2026-01-01',5,0,0,1,1,2)"))
        c.execute(sa.text("INSERT INTO game_answers (id, game_id, question_id, selected_option_id, typed_text, match, is_correct, answered_at, points, ahead, multiplier) "
                          "VALUES (2,2,1,NULL,'hallo','partial',0,'2026-01-01',5,0,1)"))  # a typed answer has no option
    command.downgrade(config, "0005")
    with engine.connect() as c:  # typing games cannot exist in the old schema; choice games are kept
        assert [r[0] for r in c.execute(sa.text("SELECT id FROM games"))] == [1]
        assert c.execute(sa.text("SELECT count(*) FROM game_answers")).scalar_one() == 1
    command.upgrade(config, "head")


def test_0007_marks_existing_songs_as_manual_and_new_ones_as_default(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'v7.db').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    config = alembic_config()
    command.upgrade(config, "0006")
    engine = sa.create_engine(url)
    with engine.begin() as c:
        c.execute(sa.text("INSERT INTO songs (id, source, file_path, file_name, content_hash, title, artist, duration, language, "
                          "available, lyrics_offset, lyrics_status, removed, created_at) "
                          "VALUES (1,'upload','/x.wav','x.wav','h','T','A',10,'fr',1,0,'found',0,'2026-01-01')"))
    command.upgrade(config, "head")
    with engine.begin() as c:
        assert c.execute(sa.text("SELECT language, language_source FROM songs")).one() == ("fr", "manual")  # left alone
        c.execute(sa.text("INSERT INTO songs (id, source, file_path, file_name, content_hash, title, artist, duration, language, "
                          "available, lyrics_offset, lyrics_status, removed, created_at) "
                          "VALUES (2,'upload','/y.wav','y.wav','h2','T','A',10,'de',1,0,'found',0,'2026-01-01')"))
        assert c.execute(sa.text("SELECT language_source FROM songs WHERE id = 2")).scalar_one() == "default"
    command.downgrade(config, "0006")
    command.upgrade(config, "head")


def test_0008_adds_the_dictionary_and_keeps_users(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'old.db').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    config = alembic_config()
    command.upgrade(config, "0007")
    engine = sa.create_engine(url)
    with engine.begin() as c:
        c.execute(sa.text("INSERT INTO users (id, username, display_name, is_guest, is_admin, created_at) VALUES (1,'ann','Ann',0,1,'2026-01-01')"))
    command.upgrade(config, "head")
    with engine.connect() as c:
        assert c.execute(sa.text("SELECT translation_language FROM users")).scalar_one() == "en"
        assert c.execute(sa.text("SELECT COUNT(*) FROM dictionary_entries")).scalar_one() == 0
    command.downgrade(config, "0007")
    assert "dictionary_entries" not in sa.inspect(engine).get_table_names()
    command.upgrade(config, "head")
