import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.test_accounts import other_browser, sign_up
from tests.test_api_games import LRC, make_wav, upload
from tests.test_game_scoring_api import answer, later_questions, new_game


@pytest.fixture
def song(api, tmp_path):
    s = upload(api, make_wav(tmp_path / "Band - Lied.wav", seconds=40)).json()
    api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("l.lrc", LRC.encode(), "text/plain")})
    return s


def play(client: TestClient, song, *, right: int, finish: bool = True, difficulty="easy"):
    """A game on `client`: the first `right` questions answered right (ahead of the music), the others wrong."""
    g = client.post("/api/games", json={"song_id": song["id"], "difficulty": difficulty}).json()
    for i, q in enumerate(g["questions"]):
        if not finish and i >= right:
            break
        answer(client, g, q, right=i < right)
    return g


def test_nothing_to_show_before_a_game_is_finished(api, song):
    g = new_game(api, song, "easy")
    answer(api, g, g["questions"][0])
    assert api.get(f"/api/songs/{song['id']}/scores").json() == []
    assert api.get("/api/scores").json() == []


def test_a_finished_game_appears_once_with_its_details(api, song):
    play(api, song, right=100)
    rows = api.get(f"/api/songs/{song['id']}/scores").json()
    assert len(rows) == 1
    row = rows[0]
    assert row["rank"] == 1 and row["display_name"] == "Guest" and row["me"] and row["difficulty"] == "easy"
    assert row["points"] > 0 and row["correct"] == row["total"] and set(row) == {
        "rank", "display_name", "points", "correct", "total", "best_multiplier", "difficulty", "finished_at", "me"}


def test_each_account_counts_once_per_song_with_its_best_game(api, song):
    sign_up(api, "anna")
    play(api, song, right=0)
    best = play(api, song, right=100)
    play(api, song, right=1)
    rows = api.get(f"/api/songs/{song['id']}/scores").json()
    assert len(rows) == 1
    assert rows[0]["points"] == api.get(f"/api/games/{best['public_id']}").json()["progress"]["score"]


def test_ranking_across_accounts_and_the_me_flag(api, song):
    sign_up(api, "anna")
    play(api, song, right=100)
    bob = other_browser(api)
    bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"})
    play(bob, song, right=2)
    guest = other_browser(api)
    play(guest, song, right=0)
    rows = bob.get(f"/api/songs/{song['id']}/scores").json()
    assert [r["display_name"] for r in rows] == ["anna", "bob", "Guest"]
    assert [r["rank"] for r in rows] == [1, 2, 3]
    assert [r["me"] for r in rows] == [False, True, False]
    assert rows[0]["points"] > rows[1]["points"] > rows[2]["points"] == 0


def test_unfinished_games_and_other_songs_do_not_count(api, song, tmp_path):
    sign_up(api, "anna")
    play(api, song, right=3, finish=False)
    other = upload(api, make_wav(tmp_path / "Other - Lied.wav", seconds=40, seed=3)).json()
    api.post(f"/api/songs/{other['id']}/lyrics/upload", files={"file": ("l.lrc", LRC.encode(), "text/plain")})
    play(api, other, right=100)
    assert api.get(f"/api/songs/{song['id']}/scores").json() == []
    assert len(api.get(f"/api/songs/{other['id']}/scores").json()) == 1


def test_global_board_sums_each_accounts_best_score_per_song(api, song, tmp_path):
    sign_up(api, "anna")
    first = play(api, song, right=100)
    play(api, song, right=1)  # worse game on the same song: not added
    other = upload(api, make_wav(tmp_path / "Other - Lied.wav", seconds=40, seed=3)).json()
    api.post(f"/api/songs/{other['id']}/lyrics/upload", files={"file": ("l.lrc", LRC.encode(), "text/plain")})
    second = play(api, other, right=100)
    rows = api.get("/api/scores").json()
    assert len(rows) == 1 and rows[0]["songs"] == 2 and rows[0]["me"]
    expected = sum(api.get(f"/api/games/{g['public_id']}").json()["progress"]["score"] for g in (first, second))
    assert rows[0]["points"] == expected


def test_a_tie_keeps_the_earlier_game_in_front(api, song):
    sign_up(api, "anna")
    play(api, song, right=0)
    bob = other_browser(api)
    bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"})
    play(bob, song, right=0)
    assert [r["display_name"] for r in api.get(f"/api/songs/{song['id']}/scores").json()] == ["anna", "bob"]


def test_unknown_song_and_sign_in_requirement(api, song):
    assert api.get("/api/songs/999/scores").status_code == 404
    sign_up(api, "boss")
    s = api.get("/api/settings").json()
    api.put("/api/settings", json={**s, "allow_guest": False})
    stranger = other_browser(api)
    assert stranger.get("/api/scores").status_code == 401 and stranger.get(f"/api/songs/{song['id']}/scores").status_code == 401
