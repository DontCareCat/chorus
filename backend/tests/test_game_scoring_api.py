import pytest

from tests.test_api_games import find_correct, new_game, song  # noqa: F401  (song is a fixture)


def later_questions(game):
    """Questions of lines that start after 0 s (the first line starts at 0, so nothing can be ahead of it)."""
    return [q for q in game["questions"] if q["audio_start"] > 0]


def answer(api, game, q, *, right=True, position=None, waited=0):
    correct = find_correct(api, game, q)
    option = correct if right else next(o["id"] for o in q["options"] if o["id"] != correct)
    body = {"question_id": q["id"], "option_id": option, "waited": waited}
    if position is not None:
        body["position"] = position
    r = api.post(f"/api/games/{game['public_id']}/answers", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_points_ahead_and_multiplier_over_a_game(api, song):
    g = new_game(api, song, "hard")
    qs = later_questions(g)
    assert len(qs) >= 6
    first = answer(api, g, qs[0], position=0.0)  # before the line starts: ahead (the first line starts at 0 s)
    assert (first["points"], first["ahead"], first["multiplier"], first["score"]) == (25, True, 1, 25)
    late = answer(api, g, qs[1], position=qs[1]["audio_start"] + 1)  # the line has begun: not ahead
    assert (late["points"], late["ahead"]) == (10, False)
    answer(api, g, qs[2])
    fourth = answer(api, g, qs[3])
    assert fourth["next_multiplier"] == 2
    fifth = answer(api, g, qs[4], position=0.0)
    assert (fifth["points"], fifth["multiplier"]) == (50, 2)  # (10 + 15) x 2
    state = api.get(f"/api/games/{g['public_id']}").json()["progress"]
    assert state["score"] == 25 + 10 + 10 + 10 + 50 and state["correct"] == 5 and state["streak"] == 5 and state["multiplier"] == 2


def test_wrong_answer_resets_and_waiting_decays(api, song):
    g = new_game(api, song, "hard")
    qs = g["questions"]
    for q in qs[:4]:
        answer(api, g, q)
    wrong = answer(api, g, qs[4], right=False)
    assert (wrong["points"], wrong["correct"], wrong["streak"], wrong["next_multiplier"]) == (0, False, 0, 1)
    for q in qs[5:9]:
        answer(api, g, q)
    decayed = answer(api, g, qs[9], waited=5)  # x2 earned, 5 s of waiting cost the level again
    assert (decayed["multiplier"], decayed["points"]) == (1, 10)
    progress = api.get(f"/api/games/{g['public_id']}").json()["progress"]
    assert progress["best_multiplier"] == 2


def test_unknown_position_never_counts_as_ahead(api, song):
    g = new_game(api, song)
    r = answer(api, g, g["questions"][0])  # no position sent
    assert not r["ahead"] and r["points"] == 10


def test_wrong_answers_are_never_ahead(api, song):
    g = new_game(api, song)
    r = answer(api, g, later_questions(g)[0], right=False, position=0.0)
    assert not r["ahead"] and r["points"] == 0


def test_repeat_answer_does_not_score_twice(api, song):
    g = new_game(api, song)
    q = later_questions(g)[0]
    a = answer(api, g, q, position=0.0)
    b = answer(api, g, q, position=0.0)
    assert b["already_answered"] and b["points"] == a["points"] and b["score"] == a["score"] == 25


def test_lyric_offset_moves_the_ahead_boundary(api, song):
    api.patch(f"/api/songs/{song['id']}", json={"lyrics_offset": 2.0})
    g = new_game(api, song)
    q, q2 = later_questions(g)[:2]
    assert answer(api, g, q, position=q["audio_start"] + 1.0)["ahead"]  # audio time = lyric time + 2 s
    assert not answer(api, g, q2, position=q2["audio_start"] + 2.5)["ahead"]


def test_payload_lists_every_line_without_leaking_question_lines(api, song):
    g = new_game(api, song, "easy")
    lines = g["lines"]
    asked = {q["line_id"] for q in g["questions"]}
    assert len(lines) == 6 and [l["sequence"] for l in lines] == list(range(6))
    assert all((l["text"] is None) == (l["line_id"] in asked) for l in lines)
    assert any(l["text"] for l in lines) and any(l["text"] is None for l in lines)
    assert all(l["audio_start"] is not None for l in lines)


def test_answers_in_the_same_game_are_applied_in_order(api, song):
    g = new_game(api, song, "hard")
    qs = g["questions"]
    totals = [answer(api, g, q)["score"] for q in qs[:6]]
    assert totals == [10, 20, 30, 40, 60, 80]


def test_summary_carries_progress(api, song):
    g = new_game(api, song, "hard")
    answer(api, g, g["questions"][0])
    summary = api.get(f"/api/songs/{song['id']}/games").json()[0]
    assert (summary["score"], summary["correct_count"], summary["answered"], summary["total"]) == (10, 1, 1, len(g["questions"]))


def test_games_keep_the_question_set_they_began_with(api, song, session):
    """A game made before the even-spread generator keeps its (version 1) questions; new games use the current set."""
    from app.db.models import Game, Question

    g = new_game(api, song, "easy")
    pid = g["public_id"]
    session.commit()
    game = session.query(Game).filter_by(public_id=pid).one()
    assert game.question_version == 2
    # turn the stored set and the game into a "version 1" game, then ask for a new game
    session.query(Question).filter_by(lyrics_id=game.lyrics_id, difficulty="easy").update({"version": 1})
    game.question_version = 1
    session.commit()
    old = api.get(f"/api/games/{pid}").json()
    assert [q["id"] for q in old["questions"]] == [q["id"] for q in g["questions"]]
    fresh = new_game(api, song, "easy")
    assert {q["id"] for q in fresh["questions"]}.isdisjoint({q["id"] for q in old["questions"]})
    session.commit()
    assert session.query(Question).filter_by(lyrics_id=game.lyrics_id, difficulty="easy", version=1).count() == len(old["questions"])
    # answering still works for the old game
    q = old["questions"][0]
    r = api.post(f"/api/games/{pid}/answers", json={"question_id": q["id"], "option_id": q["options"][0]["id"]})
    assert r.status_code == 200
    # ... and a question of the other set is not part of it
    other = fresh["questions"][0]
    assert api.post(f"/api/games/{pid}/answers", json={"question_id": other["id"], "option_id": other["options"][0]["id"]}).status_code == 404
