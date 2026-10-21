import httpx
import pytest

from app.db.models import DictionaryCache, DictionaryEntry, Question, User
from app.services.dictionary import srs
from app.services.dictionary.lookup import LookupUnavailable, Translator, article_for, parse_wikitext
from tests.test_api_games import LRC, make_wav, upload
from tests.test_accounts import other_browser

HAUS = "==German==\n===Noun===\n{{de-noun|n,s|Häuser}}\n# house\n"
HAEUSER = "==German==\n===Noun===\n{{head|de|noun form}}\n# {{plural of|de|Haus}}\n"
GEHEN = "==German==\n===Verb===\n{{de-verb}}\n# to go\n"
FRAU = "==French==\n===Noun===\n{{fr-noun|f}}\n# woman\n==German==\n===Noun===\n{{de-noun|f|-en}}\n"


@pytest.fixture
def song(api, tmp_path):
    s = upload(api, make_wav(tmp_path / "Band - Lied.wav", seconds=40)).json()
    api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("l.lrc", LRC.encode(), "text/plain")})
    return s


def start(client, song, mode="choice", difficulty="easy"):
    r = client.post("/api/games", json={"song_id": song["id"], "difficulty": difficulty, "mode": mode})
    assert r.status_code == 201, r.text
    return r.json()


def ask(client, game, q, mode="choice"):
    body = {"question_id": q["id"]}
    if mode == "typing":
        body["text"] = "zzzz"  # wrong on purpose: asked words count, right or wrong
    else:
        body["option_id"] = q["options"][0]["id"]
    r = client.post(f"/api/games/{game['public_id']}/answers", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def word_of(session, qid):
    session.commit()
    return session.get(Question, qid).missing_word


def entries(client, **params):
    r = client.get("/api/dictionary", params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- lookups ----------
def test_article_table():
    assert article_for("de", "n", "Haus") == "das" and article_for("de", "m", "Mond") == "der" and article_for("de", "f", "Sonne") == "die"
    assert article_for("fr", "f", "amie") == "l'" and article_for("fr", "m", "chat") == "le"
    assert article_for("it", "m", "zaino") == "lo" and article_for("it", "m", "gatto") == "il"
    assert article_for("de", None, "gehen") is None and article_for("sv", "n", "hus") is None


def test_parse_wikitext():
    assert parse_wikitext(HAUS, "German", "de").gender == "n"
    info = parse_wikitext(HAEUSER, "German", "de")
    assert info.gender is None and info.lemma == "Haus" and info.is_noun
    verb = parse_wikitext(GEHEN, "German", "de")
    assert verb.found and verb.gender is None and not verb.is_noun
    assert parse_wikitext(FRAU, "German", "de").gender == "f" and parse_wikitext(FRAU, "French", "fr").gender == "f"
    assert not parse_wikitext("==English==\n{{en-noun}}", "German", "de").found


def test_translator_retries_server_errors_and_reads_the_answer(dictionary):
    t = dictionary.translator()
    assert t.translate("Haus", "de", "en") == "Haus [de>en]"
    dictionary.status = 503
    with pytest.raises(LookupUnavailable):
        t.translate("Haus", "de", "en")
    assert dictionary.calls.count("tr:de|en:Haus") == 4  # one good call + three tries


def test_translator_reports_the_free_quota_as_unavailable(dictionary):
    dictionary.quota = True
    with pytest.raises(LookupUnavailable, match="MYMEMORY"):
        dictionary.translator().translate("Haus", "de", "en")


def test_texts_are_sent_out_once(session, dictionary):
    from app.services.dictionary.lookup import cached_translation

    t = dictionary.translator()
    assert cached_translation(session, t, "Haus", "de", "en") == cached_translation(session, t, "Haus", "de", "en")
    assert len([c for c in dictionary.calls if c.startswith("tr:")]) == 1
    assert session.query(DictionaryCache).count() == 1


# ---------- words land in the dictionary ----------
def test_every_asked_word_is_added_right_or_wrong_in_both_modes(api, song, session):
    g = start(api, song)
    for q in g["questions"][:3]:
        ask(api, g, q)
    words = {word_of(session, q["id"]).casefold() for q in g["questions"][:3]}
    got = entries(api)
    assert got["total"] == len(words) and {e["surface"].casefold() for e in got["items"]} == words
    t = start(api, song, "typing", "medium")
    ask(api, t, t["questions"][0], "typing")
    assert entries(api)["total"] >= len(words)
    assert word_of(session, t["questions"][0]["id"]).casefold() in {e["surface"].casefold() for e in entries(api)["items"]}


def test_a_word_asked_again_keeps_one_entry_and_adds_examples(api, song, session):
    g = start(api, song)
    q = g["questions"][0]
    ask(api, g, q)
    ask(api, g, q)  # the first answer stands: nothing new
    assert entries(api)["total"] == 1
    again = start(api, song, "typing", "hard")  # a new game over the same lyrics asks overlapping words
    for q2 in again["questions"]:
        ask(api, again, q2, "typing")
    items = entries(api)["items"]
    assert len({e["surface"].casefold() for e in items}) == len(items)
    assert all(1 <= len(e["examples"]) <= 5 for e in items)
    assert all(len({x["sentence"] for x in e["examples"]}) == len(e["examples"]) for e in items)


def test_the_example_is_the_whole_line_with_playable_timing(api, song, session):
    g = start(api, song)
    q = g["questions"][1]
    ask(api, g, q)
    entry = next(e for e in entries(api)["items"] if e["surface"].casefold() == word_of(session, q["id"]).casefold())
    ex = entry["examples"][0]
    assert q["question_text"].replace("____", "") .split()[0] in ex["sentence"] and "____" not in ex["sentence"]
    assert ex["playable"] and ex["song_title"] and ex["audio_start"] == pytest.approx(q["audio_start"])
    api.patch(f"/api/songs/{song['id']}", json={"lyrics_offset": 1.5})
    again = entries(api)["items"][0] if entries(api)["total"] == 1 else next(e for e in entries(api)["items"] if e["id"] == entry["id"])
    assert again["examples"][0]["audio_start"] == pytest.approx(q["audio_start"] + 1.5)


def test_article_and_translation_arrive_in_the_background(api, song, session, dictionary):
    g = start(api, song, "typing")
    q = g["questions"][0]
    word = word_of(session, q["id"])
    dictionary.pages[word] = HAUS
    dictionary.translations[word] = "house"
    ask(api, g, q, "typing")
    e = next(e for e in entries(api)["items"] if e["surface"] == word)
    assert (e["article"], e["translation"], e["enrich_status"], e["translation_language"]) == ("das", "house", "done", "en")
    assert e["examples"][0]["translation"].endswith("[de>en]")


def test_an_inflected_form_gets_the_article_of_its_lemma(api, song, session, dictionary):
    g = start(api, song, "typing")
    q = g["questions"][0]
    word = word_of(session, q["id"])
    dictionary.pages[word] = HAEUSER
    dictionary.pages["Haus"] = HAUS
    ask(api, g, q, "typing")
    e = next(e for e in entries(api)["items"] if e["surface"] == word)
    assert (e["lemma"], e["article"]) == ("Haus", "das")
    assert "tr:de|en:Haus" in dictionary.calls  # the dictionary form is translated, not the plural


def test_failed_lookups_can_be_repeated(api, song, session, dictionary):
    dictionary.quota = True
    g = start(api, song, "typing")
    ask(api, g, g["questions"][0], "typing")
    e = entries(api)["items"][0]
    assert e["enrich_status"] == "failed" and e["translation"] is None
    dictionary.quota = False
    r = api.post(f"/api/dictionary/{e['id']}/refresh")
    assert r.status_code == 200
    e = api.get(f"/api/dictionary/{e['id']}").json()
    assert e["enrich_status"] == "done" and e["translation"]


def test_turning_translation_off_makes_no_outside_calls(api, song, dictionary):
    s = api.get("/api/settings").json()
    api.put("/api/settings", json={**s, "translation_enabled": False})
    g = start(api, song)
    ask(api, g, g["questions"][0])
    assert dictionary.calls == [] and entries(api)["items"][0]["enrich_status"] == "pending"


def test_same_language_needs_no_translation(api, song, dictionary):
    assert api.patch("/api/auth/me", json={"translation_language": "de"}).status_code == 200
    g = start(api, song)
    ask(api, g, g["questions"][0])
    assert not [c for c in dictionary.calls if c.startswith("tr:")]
    assert entries(api)["items"][0]["enrich_status"] == "done"


def test_changing_the_translation_language_translates_again(api, song, dictionary):
    g = start(api, song)
    ask(api, g, g["questions"][0])
    assert entries(api)["items"][0]["translation_language"] == "en"
    r = api.patch("/api/auth/me", json={"translation_language": "uk"})
    assert r.json()["user"]["translation_language"] == "uk"
    e = entries(api)["items"][0]
    assert e["translation_language"] == "uk" and e["translation"].endswith("[de>uk]")


# ---------- listing ----------
def test_search_filters_and_isolation_between_users(api, song, session):
    g = start(api, song)
    for q in g["questions"][:4]:
        ask(api, g, q)
    first = entries(api)["items"][0]
    assert entries(api, q=first["surface"][:3].upper())["total"] >= 1
    assert entries(api, q="no-such-word")["total"] == 0
    assert entries(api, language="fr")["total"] == 0 and entries(api, language="de")["languages"] == [{"code": "de", "count": entries(api)["total"]}]
    assert entries(api, q="%")["total"] == 0  # not a wildcard
    api.patch(f"/api/dictionary/{first['id']}", json={"suspended": True})
    assert [e["id"] for e in entries(api, status="suspended")["items"]] == [first["id"]]
    assert first["id"] not in [e["id"] for e in entries(api, status="new")["items"]]
    bob = other_browser(api)
    assert bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"}).status_code == 201
    assert entries(bob)["total"] == 0  # the guest's words are not bob's
    assert bob.get(f"/api/dictionary/{first['id']}").status_code == 404
    assert bob.delete(f"/api/dictionary/{first['id']}").status_code == 404
    assert bob.post(f"/api/dictionary/review/{first['id']}/answer", json={"rating": "good"}).status_code == 404


def test_delete_a_word_and_a_song_removes_their_examples(api, song, session):
    g = start(api, song)
    ask(api, g, g["questions"][0])
    ask(api, g, g["questions"][1])
    a, b = entries(api)["items"][:2]
    assert api.delete(f"/api/dictionary/{a['id']}").status_code == 200 and entries(api)["total"] == 1
    assert api.delete(f"/api/songs/{song['id']}").status_code == 200  # an uploaded song is deleted for good
    assert entries(api)["items"][0]["examples"] == []


def test_import_from_past_games(api, song, session):
    g = start(api, song)
    for q in g["questions"]:
        ask(api, g, q)
    n = entries(api)["total"]
    session.query(DictionaryEntry).delete()
    session.commit()
    assert entries(api)["total"] == 0
    r = api.post("/api/dictionary/import-from-games").json()
    assert r["added"] == n and entries(api)["total"] == n
    assert api.post("/api/dictionary/import-from-games").json()["added"] == 0  # once is enough


# ---------- review ----------
def test_review_walks_a_card_through_the_buttons(api, song):
    g = start(api, song)
    ask(api, g, g["questions"][0])
    s = api.get("/api/dictionary/review/summary").json()
    assert s == {"due": 0, "new": 1, "total": 1, "available": 1, "reviewed_today": 0, "left_today": None}
    nxt = api.get("/api/dictionary/review/next").json()
    card = nxt["card"]
    assert set(card) == {"id", "word", "language", "intervals"} and card["intervals"] == {"again": 60, "hard": 600, "good": 86400, "easy": 345600}
    back = api.post(f"/api/dictionary/review/{card['id']}/answer", json={"rating": "good"}).json()
    assert back["id"] == card["id"] and back["examples"] and back["interval_seconds"] == 86400 and back["reps"] == 1
    assert api.get("/api/dictionary/review/summary").json() == {"due": 0, "new": 0, "total": 1, "available": 1, "reviewed_today": 1, "left_today": None}
    again = api.get("/api/dictionary/review/next").json()
    assert again["card"]["id"] == card["id"]  # a review always has cards: this one is simply the nearest, though its day has not come
    assert api.get(f"/api/dictionary/review/next?exclude={card['id']}").json()["card"] is None


def test_a_due_card_comes_back_with_longer_intervals(api, song, session):
    g = start(api, song)
    ask(api, g, g["questions"][0])
    card = api.get("/api/dictionary/review/next").json()["card"]
    api.post(f"/api/dictionary/review/{card['id']}/answer", json={"rating": "good"})
    from datetime import timedelta
    from app.db.models.types import utcnow

    session.expire_all()
    e = session.get(DictionaryEntry, card["id"])
    e.due_at = utcnow() - timedelta(minutes=1)
    session.commit()
    nxt = api.get("/api/dictionary/review/next").json()
    assert nxt["card"]["id"] == card["id"] and nxt["summary"]["due"] == 1
    assert nxt["card"]["intervals"] == {**srs.intervals(86400)}
    assert nxt["card"]["intervals"]["good"] > 86400


def test_suspended_cards_are_never_reviewed(api, song):
    g = start(api, song, difficulty="expert")
    for q in g["questions"]:
        ask(api, g, q)
    first = api.get("/api/dictionary/review/next").json()["card"]
    api.patch(f"/api/dictionary/{first['id']}", json={"suspended": True})
    assert api.get("/api/dictionary/review/next").json()["card"]["id"] != first["id"]
    s = api.get("/api/dictionary/review/summary").json()
    assert s["available"] == s["total"] - 1


def test_the_new_count_is_the_new_filter_and_every_new_word_can_be_reviewed(api, song):
    g = start(api, song, difficulty="expert")
    for q in g["questions"]:
        ask(api, g, q)
    total = entries(api)["total"]
    assert total > 20  # more than the old daily limit
    assert api.get("/api/dictionary/review/summary").json()["new"] == entries(api, status="new")["total"] == total
    shown = []
    while True:
        card = api.get("/api/dictionary/review/next", params={"exclude": ",".join(map(str, shown))}).json()["card"]
        if card is None:
            break
        shown.append(card["id"])
    assert sorted(shown) == sorted(e["id"] for e in entries(api, limit=500)["items"])


def test_a_session_gives_overdue_cards_then_new_then_the_nearest_upcoming(api, song, session):
    from datetime import timedelta
    from app.db.models.types import utcnow

    g = start(api, song, difficulty="expert")
    for q in g["questions"]:
        ask(api, g, q)
    ids = [e["id"] for e in entries(api, limit=500)["items"]]
    assert len(ids) >= 5
    overdue_old, overdue_new, soon, later = ids[0], ids[1], ids[2], ids[3]
    now = utcnow()
    for i, due in [(overdue_old, now - timedelta(days=3)), (overdue_new, now - timedelta(hours=1)), (soon, now + timedelta(hours=2)), (later, now + timedelta(days=9))]:
        e = session.get(DictionaryEntry, i)
        e.due_at, e.interval_seconds = due, 86400
    session.commit()
    order, shown = [], []
    while True:
        card = api.get("/api/dictionary/review/next", params={"exclude": ",".join(map(str, shown))}).json()["card"]
        if card is None:
            break
        shown.append(card["id"])
    assert shown[:2] == [overdue_old, overdue_new]  # overdue, longest overdue first
    assert shown[2:-2] and set(shown[2:-2]) == set(ids) - {overdue_old, overdue_new, soon, later}  # then the new words
    assert shown[-2:] == [soon, later]  # then the ones whose time has not come, nearest first


def test_bad_rating_is_rejected(api, song):
    g = start(api, song)
    ask(api, g, g["questions"][0])
    card = api.get("/api/dictionary/review/next").json()["card"]
    assert api.post(f"/api/dictionary/review/{card['id']}/answer", json={"rating": "meh"}).status_code == 422


def test_deleting_a_user_removes_their_words(api, song, session):
    admin = other_browser(api)
    admin.post("/api/auth/register", json={"username": "root", "password": "another pass"})
    bob = other_browser(api)
    bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"})
    g = start(bob, song)
    ask(bob, g, g["questions"][0])
    assert entries(bob)["total"] == 1
    bob_id = session.query(User).filter_by(username="bob").one().id
    assert admin.delete(f"/api/users/{bob_id}").status_code == 200
    session.rollback()  # end this session's snapshot (MySQL repeatable read) before looking again
    assert session.query(DictionaryEntry).count() == 0


# ---------- the daily card limit (per user) ----------
def test_the_daily_limit_is_a_per_user_setting_with_no_limit_by_default(api):
    me = api.get("/api/auth/me").json()["user"]
    assert me["daily_card_limit"] == 0
    r = api.patch("/api/auth/me", json={"daily_card_limit": 25})
    assert r.json()["user"]["daily_card_limit"] == 25 and r.json()["user"]["translation_language"] == "en"  # only what was sent changes
    assert api.patch("/api/auth/me", json={"daily_card_limit": -1}).status_code == 422
    assert api.patch("/api/auth/me", json={"daily_card_limit": 5000}).status_code == 422
    bob = other_browser(api)
    bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"})
    assert bob.get("/api/auth/me").json()["user"]["daily_card_limit"] == 0


def test_no_cards_are_given_once_the_daily_limit_is_reached(api, song):
    g = start(api, song, difficulty="expert")
    for q in g["questions"]:
        ask(api, g, q)
    api.patch("/api/auth/me", json={"daily_card_limit": 2})
    s = api.get("/api/dictionary/review/summary").json()
    assert (s["reviewed_today"], s["left_today"]) == (0, 2)
    for expected_left in (1, 0):
        card = api.get("/api/dictionary/review/next").json()["card"]
        assert card is not None
        api.post(f"/api/dictionary/review/{card['id']}/answer", json={"rating": "good"})
        assert api.get("/api/dictionary/review/summary").json()["left_today"] == expected_left
    assert api.get("/api/dictionary/review/next").json()["card"] is None
    api.patch("/api/auth/me", json={"daily_card_limit": 0})  # no limit again
    assert api.get("/api/dictionary/review/summary").json()["left_today"] is None
    assert api.get("/api/dictionary/review/next").json()["card"] is not None
