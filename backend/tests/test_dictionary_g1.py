"""Add modes, the word card and manual add / edit: the 0016 backfill, manual mode, lookup and add, editing."""
import hashlib
import json

import sqlalchemy as sa
from alembic import command

from app.core.config import settings
from app.db.migrate import alembic_config
from app.db.models import DictionaryEntry
from tests.test_dictionary import GEHEN, HAUS, ask, entries, start, song, word_of  # noqa: F401  (song is a fixture)


def _key(*parts: str) -> str:
    return f"wk4:{hashlib.sha1('|'.join(parts).encode()).hexdigest()}"


def _old_database(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'old.db').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    config = alembic_config()
    command.upgrade(config, "0015")
    engine = sa.create_engine(url)
    with engine.begin() as c:
        c.execute(sa.text("INSERT INTO songs (id, source, file_path, file_name, content_hash, title, artist, duration, language, available, lyrics_offset, "
                          "lyrics_status, removed, created_at) VALUES (1,'upload','/x.wav','x.wav','h','T','A',10,'de',1,0,'found',0,'2026-01-01')"))
        cols = "id,user_id,language,word,surface,enrich_status,suspended,added_at,interval_seconds,reps,lapses,lookup_version"
        rows = [
            (1, "haus#n", "Haus"),     # a '#n' key is a noun, even with no cached answer
            (2, "gehen", "gehen"),     # the cached answer says verb
            (3, "zzyzx", "zzyzx"),     # nothing cached, unknown to wordfreq
            (4, "wort", "Wort"),       # imported: no example line
        ]
        for i, word, surface in rows:
            c.execute(sa.text(f"INSERT INTO dictionary_entries ({cols}) VALUES ({i},1,'de','{word}','{surface}','done',0,'2026-01-01',0,0,0,1)"))
        c.execute(sa.text("INSERT INTO dictionary_cache (cache_key, payload, created_at) VALUES (:k, :p, '2026-01-01')"),
                  {"k": _key("de", "gehen", "None"), "p": json.dumps({"found": True, "pos": "verb"})})
        for entry_id in (1, 2, 3):
            c.execute(sa.text("INSERT INTO dictionary_examples (entry_id, song_id, sentence) VALUES (:e, 1, 'x y')"), {"e": entry_id})
    return config, engine


def test_0016_backfills_pos_zipf_and_source_and_a_second_run_changes_nothing(tmp_path, monkeypatch):
    config, engine = _old_database(tmp_path, monkeypatch)
    command.upgrade(config, "head")
    q = "SELECT id, pos, zipf, source FROM dictionary_entries ORDER BY id"
    with engine.connect() as c:
        rows = {r.id: r for r in c.execute(sa.text(q)).all()}
        assert c.execute(sa.text("SELECT dictionary_mode FROM users")).scalar_one() == "auto"  # nothing changes for existing users
    assert rows[1].pos == "noun" and rows[2].pos == "verb" and rows[3].pos is None
    assert rows[1].zipf and rows[1].zipf > 3 and rows[2].zipf > 5 and rows[3].zipf is None
    assert [rows[i].source for i in (1, 2, 3, 4)] == ["game", "game", "game", "import"]
    from importlib import import_module
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location("m0016", Path(__file__).parent.parent / "migrations" / "versions" / "0016_dictionary_pos_zipf_source.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    with engine.begin() as c:
        again = m.backfill(c)
        assert again == {"pos": 0, "zipf": 0}
        assert [tuple(r) for r in c.execute(sa.text(q)).all()] == [tuple(r) for r in rows.values()]
    command.downgrade(config, "0015")
    command.upgrade(config, "head")  # and up again


def test_the_edited_flag_and_a_typed_example_survive_in_the_schema(tmp_path, monkeypatch):
    config, engine = _old_database(tmp_path, monkeypatch)
    command.upgrade(config, "head")
    with engine.begin() as c:
        c.execute(sa.text("INSERT INTO dictionary_examples (entry_id, song_id, sentence) VALUES (1, NULL, 'typed by hand')"))
        assert c.execute(sa.text("SELECT meaning_edited FROM dictionary_entries WHERE id = 1")).scalar_one() == 0


# ---------- manual mode ----------
def test_manual_mode_skips_the_dictionary_on_game_answers_and_auto_mode_keeps_adding(api, song):
    assert api.get("/api/auth/me").json()["user"]["dictionary_mode"] == "auto"
    assert api.patch("/api/auth/me", json={"dictionary_mode": "sideways"}).status_code == 422
    r = api.patch("/api/auth/me", json={"dictionary_mode": "manual"})
    assert r.json()["user"]["dictionary_mode"] == "manual" and r.json()["user"]["daily_card_limit"] == 0
    g = start(api, song)
    ask(api, g, g["questions"][0])
    assert entries(api)["total"] == 0
    api.patch("/api/auth/me", json={"dictionary_mode": "auto"})
    ask(api, g, g["questions"][1])
    got = entries(api)
    assert got["total"] == 1 and got["items"][0]["source"] == "game"


# ---------- the word card ----------
def test_lookup_gives_the_card_and_a_second_tap_is_answered_from_the_cache(api, song, dictionary):
    dictionary.pages["Haus"] = HAUS
    dictionary.translations["house"] = "house"
    params = {"language": "de", "word": "Haus", "song_id": song["id"], "line": "Das Haus ist alt"}
    first = api.get("/api/dictionary/lookup", params=params)
    assert first.status_code == 200, first.text
    card = first.json()
    assert (card["headword"], card["pos"], card["entry_id"], card["offline"]) == ("das Haus", "noun", None, False)
    assert card["sentence"] == "Das Haus ist alt" and card["sentence_translation"].endswith("[de>en]") and card["translation"]
    calls = len(dictionary.calls)
    assert api.get("/api/dictionary/lookup", params=params).json() == card
    assert len(dictionary.calls) == calls  # nothing was asked a second time
    assert entries(api)["total"] == 0  # looking up adds nothing


def test_the_card_of_a_word_that_is_in_already_says_so(api, song, dictionary):
    dictionary.pages["Haus"] = HAUS
    added = api.post("/api/dictionary/entries", json={"language": "de", "word": "Haus", "song_id": song["id"], "line": "Das Haus ist alt"}).json()
    card = api.get("/api/dictionary/lookup", params={"language": "de", "word": "Haus", "line": "Das Haus ist alt"}).json()
    assert card["entry_id"] == added["id"] and card["headword"] == "das Haus"


def test_offline_the_card_comes_back_with_the_word_alone_and_add_still_works(api, song, dictionary):
    dictionary.status = 503
    dictionary.wikt_status = 503
    card = api.get("/api/dictionary/lookup", params={"language": "de", "word": "Haus", "line": "Das Haus ist alt"}).json()
    assert card["offline"] is True and card["headword"] == "Haus" and card["translation"] is None and card["entry_id"] is None
    r = api.post("/api/dictionary/entries", json={"language": "de", "word": "Haus", "song_id": song["id"], "line": "Das Haus ist alt"})
    assert r.status_code == 201 and r.json()["enrich_status"] in ("pending", "failed")  # looked up when the services answer again
    assert r.json()["source"] == "tap"


def test_translation_switched_off_makes_no_outside_calls_for_the_card(api, dictionary):
    api.put("/api/settings", json={"translation_enabled": False})
    card = api.get("/api/dictionary/lookup", params={"language": "de", "word": "Haus"}).json()
    assert card["translation"] is None and card["offline"] is False and not dictionary.calls


def test_adding_by_tap_keeps_the_line_with_its_timing_and_a_second_tap_adds_no_duplicate(api, song, dictionary):
    dictionary.pages["gehe"] = ""
    line = "Ich gehe jeden Morgen zur Arbeit"
    body = {"language": "de", "word": "gehe", "song_id": song["id"], "line": line}
    first = api.post("/api/dictionary/entries", json=body)
    second = api.post("/api/dictionary/entries", json=body)
    assert first.status_code == 201 and second.json()["id"] == first.json()["id"]
    e = entries(api)["items"][0]
    assert entries(api)["total"] == 1 and len(e["examples"]) == 1
    ex = e["examples"][0]
    assert ex["sentence"] == line and ex["song_id"] == song["id"] and ex["audio_start"] is not None and ex["playable"]


def test_a_tapped_word_that_was_asked_before_keeps_its_source_and_gets_the_new_line(api, song, session):
    g = start(api, song)
    ask(api, g, g["questions"][0])
    word = word_of(session, g["questions"][0]["id"])
    r = api.post("/api/dictionary/entries", json={"language": "de", "word": word, "song_id": song["id"], "line": "Eine ganz andere Zeile"})
    assert entries(api)["total"] == 1 and r.json()["source"] == "game" and len(r.json()["examples"]) == 2


def test_enrichment_writes_pos_and_zipf(api, song, dictionary):
    dictionary.pages["Haus"] = HAUS
    dictionary.pages["haus"] = HAUS
    api.post("/api/dictionary/entries", json={"language": "de", "word": "Haus", "song_id": song["id"], "line": "Das schöne Haus ist alt"})
    e = entries(api)["items"][0]
    assert (e["pos"], e["enrich_status"]) == ("noun", "done") and e["zipf"] is not None and e["zipf"] > 3


def test_zipf_is_empty_for_a_language_without_data(api, dictionary):
    r = api.post("/api/dictionary/entries", json={"language": "ja", "word": "猫", "source": "manual"})
    assert r.status_code == 201
    assert entries(api)["items"][0]["zipf"] is None


def test_another_user_cannot_see_or_reach_my_added_words(api, song):
    from tests.test_accounts import other_browser

    mine = api.post("/api/dictionary/entries", json={"language": "de", "word": "Haus", "song_id": song["id"], "line": "x"}).json()
    bob = other_browser(api)
    bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"})
    assert entries(bob)["total"] == 0
    assert bob.patch(f"/api/dictionary/{mine['id']}", json={"translation": "x"}).status_code == 404


def test_an_unknown_song_and_an_empty_word_are_refused(api):
    assert api.post("/api/dictionary/entries", json={"language": "de", "word": "Haus", "song_id": 999, "line": "x"}).status_code == 404
    assert api.post("/api/dictionary/entries", json={"language": "de", "word": "  ", "source": "manual"}).status_code == 422


# ---------- manual add and edit ----------
def test_manual_add_keeps_the_meaning_and_example_the_user_typed(api, dictionary):
    dictionary.pages["Haus"] = HAUS
    r = api.post("/api/dictionary/entries", json={
        "language": "de", "word": "Haus", "source": "manual", "translation": "my own house", "example": "Das ist mein Haus"})
    assert r.status_code == 201
    e = entries(api)["items"][0]
    assert (e["source"], e["translation"], e["meaning_edited"], e["article"], e["pos"]) == ("manual", "my own house", True, "das", "noun")
    assert e["examples"][0]["sentence"] == "Das ist mein Haus" and e["examples"][0]["song_id"] is None and e["examples"][0]["playable"] is False


def test_manual_add_without_a_meaning_gets_one_from_the_lookup(api, dictionary):
    dictionary.pages["Haus"] = HAUS
    dictionary.translations["house"] = "house"
    api.post("/api/dictionary/entries", json={"language": "de", "word": "Haus", "source": "manual"})
    e = entries(api)["items"][0]
    assert e["translation"] and e["meaning_edited"] is False and e["enrich_status"] == "done"


def test_editing_meaning_lemma_article_and_pos_and_clearing_a_field(api, dictionary):
    created = api.post("/api/dictionary/entries", json={"language": "de", "word": "Haus", "source": "manual"}).json()
    r = api.patch(f"/api/dictionary/{created['id']}", json={"translation": "building", "lemma": "Haus", "article": "das", "pos": "noun"})
    e = r.json()
    assert (e["translation"], e["lemma"], e["article"], e["pos"], e["meaning_edited"], e["suspended"]) == ("building", "Haus", "das", "noun", True, False)
    assert api.patch(f"/api/dictionary/{created['id']}", json={"article": ""}).json()["article"] is None
    assert api.patch(f"/api/dictionary/{created['id']}", json={"suspended": True}).json()["translation"] == "building"  # only what was sent changes


def test_a_look_up_never_replaces_an_edited_meaning_unless_confirmed(api, dictionary):
    dictionary.pages["Haus"] = HAUS
    dictionary.translations["house"] = "house"
    created = api.post("/api/dictionary/entries", json={"language": "de", "word": "Haus", "source": "manual", "translation": "mine"}).json()
    assert entries(api)["items"][0]["translation"] == "mine"  # the background lookup filled the article and kept the meaning
    asked = api.post(f"/api/dictionary/{created['id']}/refresh")
    assert asked.status_code == 409 and asked.json()["error"]["code"] == "meaning_edited"
    assert api.get(f"/api/dictionary/{created['id']}").json()["translation"] == "mine"
    api.post(f"/api/dictionary/{created['id']}/refresh", params={"overwrite": "true"})
    e = api.get(f"/api/dictionary/{created['id']}").json()
    assert e["translation"] == "house" and e["meaning_edited"] is False


def test_the_background_lookup_keeps_an_edited_lemma_and_pos(api, dictionary, session):
    created = api.post("/api/dictionary/entries", json={"language": "de", "word": "gehen", "source": "manual"}).json()
    api.patch(f"/api/dictionary/{created['id']}", json={"pos": "other", "translation": "walk"})
    dictionary.pages["gehen"] = GEHEN
    session.expire_all()
    e = session.get(DictionaryEntry, created["id"])
    e.enrich_status = "pending"
    session.commit()
    entries(api)  # listing starts the lookups of pending words
    got = api.get(f"/api/dictionary/{created['id']}").json()
    assert (got["pos"], got["translation"], got["enrich_status"]) == ("other", "walk", "done")
