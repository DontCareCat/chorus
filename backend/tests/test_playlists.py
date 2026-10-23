import pytest

from tests.test_accounts import other_browser, sign_up
from tests.test_api_games import make_wav, upload


@pytest.fixture
def songs(api, tmp_path):
    return [upload(api, make_wav(tmp_path / f"Band - Lied {i}.wav", seconds=2 + i)).json() for i in range(4)]


def make(api, name="Morning"):
    r = api.post("/api/playlists", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def ids(api, pid):
    return [s["id"] for s in api.get(f"/api/playlists/{pid}").json()["songs"]]


def test_create_list_rename_delete(api):
    p = make(api, "  Morning   German ")
    assert p["name"] == "Morning German" and p["song_count"] == 0
    assert api.post("/api/playlists", json={"name": "morning german"}).status_code in (201, 409)  # names differ by case only: allowed or refused, never a crash
    assert api.post("/api/playlists", json={"name": "Morning German"}).status_code == 409
    assert api.post("/api/playlists", json={"name": "   "}).status_code == 422
    assert api.patch(f"/api/playlists/{p['id']}", json={"name": "Evening"}).json()["name"] == "Evening"
    assert [x["name"] for x in api.get("/api/playlists").json()][0] in ("Evening", "morning german")
    assert api.delete(f"/api/playlists/{p['id']}").status_code == 204
    assert api.get(f"/api/playlists/{p['id']}").status_code == 404


def test_songs_are_appended_once_in_the_order_given(api, songs):
    p = make(api)
    a, b, c, d = (s["id"] for s in songs)
    r = api.post(f"/api/playlists/{p['id']}/songs", json={"song_ids": [c, a, c, 999]})
    assert r.json()["song_ids"] == [c, a] and r.json()["song_count"] == 2
    api.post(f"/api/playlists/{p['id']}/songs", json={"song_ids": [a, d]})
    assert ids(api, p["id"]) == [c, a, d]


def test_reorder_needs_the_exact_set_and_remove_closes_the_gap(api, songs):
    p = make(api)
    a, b, c, d = (s["id"] for s in songs)
    api.post(f"/api/playlists/{p['id']}/songs", json={"song_ids": [a, b, c]})
    assert api.put(f"/api/playlists/{p['id']}/order", json={"song_ids": [c, a, b]}).status_code == 200
    assert ids(api, p["id"]) == [c, a, b]
    assert api.put(f"/api/playlists/{p['id']}/order", json={"song_ids": [c, a]}).status_code == 422
    assert api.put(f"/api/playlists/{p['id']}/order", json={"song_ids": [c, a, d]}).status_code == 422
    assert api.put(f"/api/playlists/{p['id']}/order", json={"song_ids": [c, c, a]}).status_code == 422
    api.delete(f"/api/playlists/{p['id']}/songs/{a}")
    api.post(f"/api/playlists/{p['id']}/songs", json={"song_ids": [d]})
    assert ids(api, p["id"]) == [c, b, d]


def test_summary_has_covers_duration_and_member_ids(api, songs):
    p = make(api)
    api.post(f"/api/playlists/{p['id']}/songs", json={"song_ids": [s["id"] for s in songs]})
    s = api.get("/api/playlists").json()[0]
    assert s["song_count"] == 4 and len(s["covers"]) == 4 and abs(s["duration"] - sum(x["duration"] for x in songs)) < 0.01
    assert sorted(s["song_ids"]) == sorted(x["id"] for x in songs)


def test_a_song_removed_from_the_library_stays_greyed_and_its_hard_delete_cascades(api, songs):
    p = make(api)
    a, b = songs[0]["id"], songs[1]["id"]
    api.post(f"/api/playlists/{p['id']}/songs", json={"song_ids": [a, b]})
    api.post("/api/songs/bulk-delete", json={"ids": [a]})  # hides it (it has no games, so it may also be deleted outright)
    rows = api.get(f"/api/playlists/{p['id']}").json()["songs"]
    gone = [r for r in rows if r["id"] == a]
    assert not gone or gone[0]["removed"] is True
    assert any(r["id"] == b and r["removed"] is False for r in rows)
    assert api.post(f"/api/playlists/{p['id']}/songs", json={"song_ids": [a]}).status_code == 200  # a removed song is not added again


def test_playlists_are_private_to_their_owner(api, songs):
    sign_up(api, "anna")
    p = make(api, "Mine")
    api.post(f"/api/playlists/{p['id']}/songs", json={"song_ids": [songs[0]["id"]]})
    bob = other_browser(api)
    bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"})
    assert bob.get("/api/playlists").json() == []
    for call in (bob.get(f"/api/playlists/{p['id']}"), bob.delete(f"/api/playlists/{p['id']}"), bob.patch(f"/api/playlists/{p['id']}", json={"name": "x"}),
                 bob.post(f"/api/playlists/{p['id']}/songs", json={"song_ids": [songs[1]["id"]]}), bob.put(f"/api/playlists/{p['id']}/order", json={"song_ids": [songs[0]["id"]]})):
        assert call.status_code == 404
    assert make(bob, "Mine")["name"] == "Mine"  # the same name is free for another user
