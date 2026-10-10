import pytest

from app.db.models import Question
from app.services.game.generator import TYPING_PERCENT, build_drafts, question_target, unique_word_count, select_lines
from tests.test_api_games import LRC, make_wav, upload
from tests.test_scores import play  # noqa: F401  (helper)
from tests.test_generator import lyr, total_words


@pytest.fixture
def song(api, tmp_path):
    s = upload(api, make_wav(tmp_path / "Band - Lied.wav", seconds=40)).json()
    api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("l.lrc", LRC.encode(), "text/plain")})
    return s


def new_typing(api, song, difficulty="easy"):
    r = api.post("/api/games", json={"song_id": song["id"], "difficulty": difficulty, "mode": "typing"})
    assert r.status_code == 201, r.text
    return r.json()


def word_of(session, qid):
    session.commit()
    return session.get(Question, qid).missing_word


def type_answer(api, game, q, text, position=None, waited=0):
    body = {"question_id": q["id"], "text": text, "waited": waited}
    if position is not None:
        body["position"] = position
    r = api.post(f"/api/games/{game['public_id']}/answers", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def later(game):
    return [q for q in game["questions"] if q["audio_start"] > 0]


def test_typing_levels_ask_10_25_40_60_percent_of_the_words():
    assert TYPING_PERCENT == {"easy": 10, "medium": 25, "hard": 40, "expert": 60}
    lyrics = lyr()
    total = total_words(lyrics)
    counts = []
    for d in ("easy", "medium", "hard", "expert"):
        drafts = build_drafts(lyrics, "de", d, "typing")
        want = question_target(total, d, "typing")
        assert abs(len(drafts) - want) <= max(2, round(want * 0.15)), (d, len(drafts), want)
        counts.append(len(drafts))
    assert counts == sorted(counts) and len(set(counts)) == 4
    assert all(d.options == [] for d in build_drafts(lyrics, "de", "hard", "typing"))  # nothing to choose from


def test_a_typing_game_has_no_options_and_hides_the_word(api, song):
    g = new_typing(api, song)
    assert g["mode"] == "typing" and g["questions"]
    assert all(q["options"] == [] and q["word"] is None and q["text"] is None for q in g["questions"])
    assert "____" in g["questions"][0]["question_text"]


def test_typing_and_choice_sets_live_side_by_side(api, song):
    typing = new_typing(api, song, "medium")
    choice = api.post("/api/games", json={"song_id": song["id"], "difficulty": "medium"}).json()
    assert choice["mode"] == "choice" and choice["questions"][0]["options"]
    assert {q["id"] for q in typing["questions"]}.isdisjoint({q["id"] for q in choice["questions"]})
    assert new_typing(api, song, "medium")["questions"][0]["id"] == typing["questions"][0]["id"]  # cached


def test_full_partial_and_wrong_answers(api, song, session):
    g = new_typing(api, song, "hard")
    qs = later(g)
    w0, w1, w2, w3 = (word_of(session, q["id"]) for q in qs[:4])
    full = type_answer(api, g, qs[0], w0.upper(), position=qs[0]["audio_start"] + 5)  # not ahead; case is ignored
    assert (full["match"], full["correct"], full["points"], full["ahead"], full["word"]) == ("full", True, 10, False, w0)
    partial = type_answer(api, g, qs[1], w1[:-1] + ("x" if w1[-1] != "x" else "y"), position=qs[1]["audio_start"] + 5)
    assert (partial["match"], partial["correct"], partial["points"], partial["streak"]) == ("partial", False, 5, 1)
    wrong = type_answer(api, g, qs[2], "qqqqqqqq")
    assert (wrong["match"], wrong["points"], wrong["streak"], wrong["next_multiplier"]) == ("none", 0, 0, 1)
    state = api.get(f"/api/games/{g['public_id']}").json()
    assert state["progress"]["score"] == 15 and state["progress"]["correct"] == 1
    first = next(x for x in state["questions"] if x["id"] == qs[0]["id"])
    answered = first["answer"]
    assert answered["typed_text"] == w0.upper() and answered["match"] == "full" and answered["word"] == w0
    assert first["word"] == w0 and first["options"] == []


def test_answering_ahead_multiplies_by_1_5(api, song, session):
    g = new_typing(api, song, "hard")
    qs = later(g)
    a = type_answer(api, g, qs[0], word_of(session, qs[0]["id"]), position=0.0)
    assert (a["points"], a["ahead"], a["multiplier"]) == (15, True, 1)
    typo = word_of(session, qs[1]["id"])
    b = type_answer(api, g, qs[1], typo[:-1] + ("x" if typo[-1] != "x" else "y"), position=0.0)
    assert (b["match"], b["points"], b["ahead"]) == ("partial", 8, True)  # 5 x 1.5 = 7.5 rounds up
    c = type_answer(api, g, qs[2], "qqqqqqqq", position=0.0)
    assert (c["points"], c["ahead"]) == (0, False)


def test_the_streak_multiplier_applies_and_partial_keeps_it(api, song, session):
    g = new_typing(api, song, "hard")
    qs = later(g)
    for q in qs[:4]:
        type_answer(api, g, q, word_of(session, q["id"]))
    typo = word_of(session, qs[4]["id"])
    p = type_answer(api, g, qs[4], typo[:-1] + ("x" if typo[-1] != "x" else "y"))
    assert (p["multiplier"], p["points"], p["streak"], p["next_multiplier"]) == (2, 10, 4, 2)  # 5 x 2, streak unchanged
    f = type_answer(api, g, qs[5], word_of(session, qs[5]["id"]))
    assert (f["multiplier"], f["points"], f["streak"]) == (2, 20, 5)


def test_typing_answers_are_idempotent_and_validated(api, song, session):
    g = new_typing(api, song)
    q = g["questions"][0]
    first = type_answer(api, g, q, "qqqqqq")
    second = type_answer(api, g, q, word_of(session, q["id"]))
    assert second["already_answered"] and second["match"] == "none" and second["score"] == first["score"]
    q2 = g["questions"][1]
    for body in ({"question_id": q2["id"]}, {"question_id": q2["id"], "text": "   "}):
        r = api.post(f"/api/games/{g['public_id']}/answers", json=body)
        assert r.status_code == 422 and r.json()["error"]["code"] == "answer_required"
    r = api.post(f"/api/games/{g['public_id']}/answers", json={"question_id": q2["id"], "option_id": 1})
    assert r.status_code == 422  # choosing an option is not typing
    assert api.post(f"/api/games/{g['public_id']}/answers", json={"question_id": q2["id"], "text": "x" * 101}).status_code == 422


def test_choice_games_still_refuse_typed_answers(api, song):
    g = api.post("/api/games", json={"song_id": song["id"], "difficulty": "easy"}).json()
    r = api.post(f"/api/games/{g['public_id']}/answers", json={"question_id": g["questions"][0]["id"], "text": "Haus"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "wrong_answer_type"


def test_an_unknown_mode_is_refused(api, song):
    r = api.post("/api/games", json={"song_id": song["id"], "difficulty": "easy", "mode": "karaoke"})
    assert r.status_code == 422


def test_finishing_a_typing_game_and_separate_scoreboards(api, song, session):
    g = new_typing(api, song, "easy")
    for q in g["questions"]:
        r = type_answer(api, g, q, word_of(session, q["id"]), position=0.0)
    assert r["finished"]
    assert api.get(f"/api/songs/{song['id']}/scores").json() == []  # the choice board knows nothing about it
    rows = api.get(f"/api/songs/{song['id']}/scores", params={"mode": "typing"}).json()
    assert len(rows) == 1 and rows[0]["mode"] == "typing" and rows[0]["points"] > 0 and rows[0]["correct"] == rows[0]["total"]
    assert api.get("/api/scores").json() == []
    assert api.get("/api/scores", params={"mode": "typing"}).json()[0]["points"] == rows[0]["points"]
    summary = api.get(f"/api/songs/{song['id']}/games").json()[0]
    assert summary["mode"] == "typing" and summary["total"] == len(g["questions"])
    assert api.get("/api/scores", params={"mode": "karaoke"}).status_code == 422
