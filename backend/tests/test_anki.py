import io
import zipfile
from datetime import datetime, timedelta, timezone

import pytest

from app.core.errors import AppError
from app.services.dictionary import anki

NOW = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)


def words():
    return [
        anki.ExportWord("de", "hund", "Hund", "der", "dog", [("Der Hund bellt", "The dog barks", "Song A"), ("Der Hund bellt!", None, "Song B")], NOW + timedelta(days=10), 5 * 86400, 3, 1),
        anki.ExportWord("de", "haus", "Haus", "das", "house <b>", [], None, 0, 0, 0),
        anki.ExportWord("de", "laufen", "laufen", None, None, [], NOW + timedelta(minutes=10), 600, 1, 0, suspended=True),
    ]


def test_an_apkg_is_a_zip_with_a_collection_and_a_media_map():
    z = zipfile.ZipFile(io.BytesIO(anki.build_apkg(words(), "Chorus", True, NOW)))
    assert set(z.namelist()) == {"collection.anki2", "media"} and z.read("media") == b"{}"


def test_export_and_read_back_with_the_schedule():
    notes = anki.parse_apkg(anki.build_apkg(words(), "Chorus", True, NOW))
    assert [n.front for n in notes] == ["der Hund", "das Haus", "laufen"]
    assert notes[0].back == "dog"  # the song lines stay in Anki, they are not a translation
    assert notes[1].back == "house <b>"  # text, not markup
    assert (notes[0].interval_seconds, notes[0].reps, notes[0].lapses) == (5 * 86400, 3, 1)
    assert notes[0].due_at.date() == (NOW + timedelta(days=10)).date()
    assert notes[2].suspended and notes[2].reps == 1 and notes[2].interval_seconds == 600
    assert notes[0].tags == ["de", "chorus"]


def test_without_the_schedule_every_card_is_new():
    notes = anki.parse_apkg(anki.build_apkg(words(), "Chorus", False, NOW))
    assert all(n.reps == 0 and n.due_at is None and n.interval_seconds == 0 for n in notes)


def test_plain_text_round_trip_and_headers():
    text = anki.build_text(words())
    assert text.startswith("#separator:tab\n#html:true\n#tags column:3\n")
    notes = anki.parse_text(text)
    assert [n.front for n in notes] == ["der Hund", "das Haus", "laufen"] and notes[0].tags == ["de", "chorus"]
    assert [(n.front, n.back) for n in anki.parse_text("Baum;tree\nKatze;cat\n")] == [("Baum", "tree"), ("Katze", "cat")]
    assert anki.parse_text("") == []


def test_not_a_deck_and_the_newer_format():
    with pytest.raises(AppError) as e:
        anki.parse_apkg(b"hello")
    assert e.value.code == "not_a_deck"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("collection.anki21b", b"x")
        z.writestr("meta", b"x")
    with pytest.raises(AppError) as e:
        anki.parse_apkg(buf.getvalue())
    assert e.value.code == "deck_newer_format" and "Support older Anki versions" in e.value.message


def test_split_article():
    assert anki.split_article("der Hund", "de") == ("der", "Hund")
    assert anki.split_article("Der Hund", "de-AT") == ("der", "Hund")
    assert anki.split_article("l'amour", "fr") == ("l'", "amour")
    assert anki.split_article("the dog", "en") == (None, "the dog")
    assert anki.split_article("die", "de") == (None, "die")


def make_entry(api, language="de"):
    return api.get("/api/dictionary").json()


def test_export_and_import_through_the_api(api, session):
    from app.db.models import DictionaryEntry, User
    api.get("/api/dictionary")  # the guest account exists once it is used
    user = session.query(User).first()
    session.add(DictionaryEntry(user_id=user.id, language="de", word="hund", surface="Hund", article="der", translation="dog", translation_language="en", enrich_status="done"))
    session.add(DictionaryEntry(user_id=user.id, language="fr", word="chat", surface="chat", article="le", translation="cat", translation_language="en", enrich_status="done"))
    session.commit()
    r = api.get("/api/dictionary/export", params={"language": "de"})
    assert r.status_code == 200 and "chorus-dictionary-" in r.headers["content-disposition"] and r.headers["content-disposition"].endswith('.apkg"')
    assert [n.front for n in anki.parse_apkg(r.content)] == ["der Hund"]  # only the words the filter shows
    txt = api.get("/api/dictionary/export", params={"format": "txt"}).text
    assert "der Hund" in txt and "le chat" in txt
    assert api.get("/api/dictionary/export", params={"language": "es"}).json()["error"]["code"] == "nothing_to_export"
    deck = anki.build_apkg(words(), "Chorus", True, NOW)
    out = api.post("/api/dictionary/import-deck", data={"language": "de", "schedule": "true"}, files={"file": ("d.apkg", deck, "application/octet-stream")}).json()
    assert out == {"added": 2, "existing": 1, "skipped": 0}  # "der Hund" was already there
    page = api.get("/api/dictionary", params={"language": "de"}).json()["items"]
    laufen = next(i for i in page if i["surface"] == "laufen")
    assert laufen["suspended"] is True and laufen["reps"] == 1
    haus = next(i for i in page if i["surface"] == "Haus")
    assert haus["article"] == "das" and haus["translation"] == "house <b>"
    again = api.post("/api/dictionary/import-deck", data={"language": "de"}, files={"file": ("d.apkg", deck, "application/octet-stream")}).json()
    assert again == {"added": 0, "existing": 3, "skipped": 0}
    bad = api.post("/api/dictionary/import-deck", data={"language": "de"}, files={"file": ("x.txt", b"", "text/plain")})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "nothing_to_import"
    txt_import = api.post("/api/dictionary/import-deck", data={"language": "es"}, files={"file": ("x.tsv", "el gato\tcat\n".encode(), "text/plain")})
    assert txt_import.status_code == 200 and txt_import.json()["added"] == 1
    gato = next(i for i in api.get("/api/dictionary", params={"language": "es"}).json()["items"])
    assert (gato["article"], gato["surface"], gato["translation"]) == ("el", "gato", "cat")


# ---------- review fixes ----------

def _words(**kw):
    from app.services.dictionary import anki
    base = dict(language="de", word="haus", surface="Haus", article="das", translation=None, examples=[("Das Haus <b> ist", None, "Song")], user_id=1)
    base.update(kw)
    return anki.ExportWord(**base)


def test_untranslated_word_comes_back_without_translation():
    from datetime import datetime, timezone
    from app.services.dictionary import anki
    notes = anki.parse_apkg(anki.build_apkg([_words()], "Chorus", False, datetime.now(timezone.utc)))
    assert notes[0].front == "das Haus" and notes[0].back == ""


def test_front_is_escaped_and_hash_is_quoted():
    from datetime import datetime, timezone
    from app.services.dictionary import anki
    w = _words(word="r&b", surface="R&B", article=None)
    notes = anki.parse_apkg(anki.build_apkg([w], "Chorus", False, datetime.now(timezone.utc)))
    assert notes[0].front == "R&B"
    assert anki.build_text([_words(surface="#x", article=None)]).splitlines()[3].startswith('"#x"')


def test_malformed_collections_are_not_a_deck():
    import io, sqlite3, tempfile, zipfile, os
    import pytest
    from app.core.errors import AppError
    from app.services.dictionary import anki

    def deck(sql):
        fd, path = tempfile.mkstemp(); os.close(fd)
        db = sqlite3.connect(path); db.executescript(sql); db.commit(); db.close()
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.write(path, "collection.anki2")
        os.unlink(path)
        return buf.getvalue()

    full = "CREATE TABLE col (id, crt, models); CREATE TABLE notes (id, mid, tags, flds); CREATE TABLE cards (nid, type, queue, due, ivl, reps, lapses, ord, id);"
    for sql in (
        full,  # empty col
        full + "INSERT INTO col VALUES (1, 0, '[1]');",
        full + "INSERT INTO col VALUES (1, 0, '{}'); INSERT INTO notes VALUES (1, 1, NULL, NULL);",
        "CREATE TABLE col (id, crt, models); INSERT INTO col VALUES (1, 0, '{}'); CREATE VIEW notes AS SELECT 1 AS id, 1 AS mid, '' AS tags, 'a' AS flds; CREATE TABLE cards (nid);",
    ):
        with pytest.raises(AppError) as e:
            anki.parse_apkg(deck(sql))
        assert e.value.code == "not_a_deck"


def test_quoted_csv_and_plain_text():
    from app.services.dictionary import anki
    notes = anki.parse_text('"dog, hound";"a ""pet"""\nR&B < 3;x\n')
    assert notes[0].front == "dog, hound" and notes[0].back == 'a "pet"'
