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
        "rank", "display_name", "points", "correct", "total", "best_multiplier", "difficulty", "mode", "finished_at", "me"}


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


def test_song_list_carries_my_own_score_plays_and_last_played(api, song):
    row = api.get("/api/songs").json()[0]
    assert (row["best_score"], row["plays"], row["last_played_at"]) == (None, 0, None)
    play(api, song, right=0)
    best = play(api, song, right=100)
    play(api, song, right=1, finish=False)  # unfinished games do not count
    row = api.get("/api/songs").json()[0]
    assert row["plays"] == 2 and row["last_played_at"]
    assert row["best_score"] == api.get(f"/api/games/{best['public_id']}").json()["progress"]["score"]
    bob = other_browser(api)  # another account sees none of mine
    bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"})
    assert bob.get("/api/songs").json()[0]["plays"] == 0


def test_limit_gives_the_top_my_own_row_below_it_and_the_player_count(api, song):
    sign_up(api, "anna")
    play(api, song, right=100)
    others = []
    for i, right in enumerate([60, 40, 20]):
        c = other_browser(api)
        c.post("/api/auth/register", json={"username": f"user{i}", "password": "another pass"})
        play(c, song, right=right)
        others.append(c)
    last = other_browser(api)
    play(last, song, right=0)
    board = last.get(f"/api/songs/{song['id']}/scores?limit=2").json()
    assert board["players"] == 5 and [r["rank"] for r in board["rows"]] == [1, 2]
    assert board["me"]["rank"] == 5 and board["me"]["me"] is True  # outside the top: the caller's own row with the real rank
    inside = others[0].get(f"/api/songs/{song['id']}/scores?limit=3").json()
    assert inside["me"] is None and inside["players"] == 5  # inside the top: no extra row
    assert last.get(f"/api/songs/{song['id']}/scores").json()  # without limit: still the plain list
    assert isinstance(last.get(f"/api/songs/{song['id']}/scores").json(), list)


def test_global_board_limit_and_mine(api, song):
    sign_up(api, "anna")
    play(api, song, right=100)
    bob = other_browser(api)
    bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"})
    play(bob, song, right=3)
    g = bob.get("/api/scores?limit=1").json()
    assert g["players"] == 2 and len(g["rows"]) == 1 and g["me"]["rank"] == 2


def test_mine_lists_the_songs_i_finished_with_my_place_and_my_total(api, song, tmp_path):
    sign_up(api, "anna")
    other = upload(api, make_wav(tmp_path / "Band - Zwei.wav", seconds=42)).json()
    api.post(f"/api/songs/{other['id']}/lyrics/upload", files={"file": ("l.lrc", LRC.encode(), "text/plain")})
    play(api, song, right=100)
    unfinished = api.post("/api/games", json={"song_id": other["id"], "difficulty": "easy"}).json()
    answer(api, unfinished, unfinished["questions"][0])  # not finished: not listed
    bob = other_browser(api)
    bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"})
    play(bob, song, right=200)
    mine = api.get("/api/scores/mine").json()
    assert [r["song_id"] for r in mine["songs"]] == [song["id"]]
    row = mine["songs"][0]
    assert row["title"] and row["players"] == 2 and row["rank"] in (1, 2) and row["removed"] is False and row["points"] > 0
    assert mine["overall"]["songs"] == 1 and mine["overall"]["players"] == 2 and mine["overall"]["points"] == row["points"]
    assert api.get("/api/scores/mine?mode=typing").json() == {"songs": [], "overall": None}
    play(api, other_song := other, right=1)
    again = api.get("/api/scores/mine").json()
    assert [r["song_id"] for r in again["songs"]] == [other_song["id"], song["id"]]  # newest finished game first
    assert again["overall"]["songs"] == 2


def test_a_hidden_library_song_stays_in_mine_with_the_removed_flag(api, song, session):
    sign_up(api, "anna")
    play(api, song, right=100)
    from app.db.models import Song as SongRow
    session.get(SongRow, song["id"]).removed = True
    session.commit()
    row = api.get("/api/scores/mine").json()["songs"][0]
    assert row["removed"] is True
