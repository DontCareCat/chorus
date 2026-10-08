from tests.conftest import lrclib_json, make_wav
from tests.test_api_library import upload

PLAIN_ONLY = dict(synced=None)


def add_song(api, tmp_path, name="Rammstein - Du hast.wav", seconds=2.0, seed=0):
    return upload(api, make_wav(tmp_path / name, seconds, seed)).json()


def status(api, song_id):
    return next(s for s in api.get("/api/songs").json() if s["id"] == song_id)["lyrics_status"]


def test_confident_match_attached_automatically_on_upload(api, lrclib, tmp_path):
    lrclib.get_result = lrclib_json(duration=2.0)
    s = add_song(api, tmp_path)
    assert status(api, s["id"]) == "found"
    lyr = api.get(f"/api/songs/{s['id']}/lyrics").json()
    assert lyr["is_synced"] and lyr["source"] == "lrclib"
    assert [(l["start_time"], l["end_time"]) for l in lyr["lines"]] == [(0.5, 1.2), (1.2, 2.0)]


def test_auto_fetch_can_be_disabled(api, lrclib, tmp_path):
    lrclib.get_result = lrclib_json()
    api.put("/api/settings", json={**api.get("/api/settings").json(), "auto_fetch_lyrics": False})
    s = add_song(api, tmp_path)
    assert status(api, s["id"]) == "pending" and lrclib.calls == []


def test_duration_mismatch_needs_choice(api, lrclib, tmp_path):
    lrclib.get_result = lrclib_json(duration=200.0)  # not the same version of the song
    lrclib.search_result = [lrclib_json(id=1, duration=200), lrclib_json(id=2, duration=2.5)]
    s = add_song(api, tmp_path)
    assert status(api, s["id"]) == "needs_choice"
    d = api.post(f"/api/songs/{s['id']}/lyrics/discover").json()
    assert [c["id"] for c in d["candidates"]] == [2, 1]  # closest duration first
    lrclib.by_id[2] = lrclib_json(id=2, duration=2.5)
    r = api.post(f"/api/songs/{s['id']}/lyrics", json={"lrclib_id": 2})
    assert r.status_code == 201 and status(api, s["id"]) == "found"


def test_not_found_then_manual_search_and_upload(api, lrclib, tmp_path):
    s = add_song(api, tmp_path)
    assert status(api, s["id"]) == "not_found"
    lrclib.search_result = [lrclib_json(id=5, artist="Other", title="Song")]
    found = api.get(f"/api/songs/{s['id']}/lyrics/search", params={"q": "other song"}).json()
    assert found[0]["id"] == 5
    up = api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("x.lrc", b"[00:01.00] eins\n[00:02.00] zwei", "text/plain")})
    assert up.status_code == 201 and up.json()["source"] == "upload"
    assert status(api, s["id"]) == "found"


def test_unsynced_hidden_until_setting_enabled(api, lrclib, tmp_path):
    lrclib.get_result = lrclib_json(**PLAIN_ONLY)
    lrclib.search_result = [lrclib_json(**PLAIN_ONLY)]
    s = add_song(api, tmp_path)
    assert status(api, s["id"]) == "not_found"
    d = api.post(f"/api/songs/{s['id']}/lyrics/discover").json()
    assert d["candidates"] == [] and d["unsynced_hidden"] >= 1
    manual = api.get(f"/api/songs/{s['id']}/lyrics/search").json()
    assert manual[0]["usable"] is False and manual[0]["has_plain"]
    # unsynchronized upload is refused while the setting is off ...
    r = api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("p.txt", b"eins\nzwei", "text/plain")})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsynchronized_not_allowed"
    # ... and accepted / auto-discovered once enabled
    api.put("/api/settings", json={**api.get("/api/settings").json(), "allow_unsynchronized_lyrics": True})
    d = api.post(f"/api/songs/{s['id']}/lyrics/discover").json()
    assert d["status"] == "found" and d["lyrics"]["is_synced"] is False
    assert all(l["start_time"] is None for l in d["lyrics"]["lines"])


def test_synced_preferred_over_plain_in_ranking(api, lrclib, tmp_path):
    api.put("/api/settings", json={**api.get("/api/settings").json(), "allow_unsynchronized_lyrics": True})
    lrclib.search_result = [lrclib_json(id=1, **PLAIN_ONLY), lrclib_json(id=2)]
    s = add_song(api, tmp_path)
    d = api.post(f"/api/songs/{s['id']}/lyrics/discover").json()
    assert [c["id"] for c in d["candidates"]] == [2, 1]


def test_instrumental_never_usable(api, lrclib, tmp_path):
    lrclib.get_result = lrclib_json(instrumental=True, synced=None, plain=None)
    s = add_song(api, tmp_path)
    assert status(api, s["id"]) == "not_found"


def test_sidecar_lrc_wins_without_network(api, lrclib, tmp_path):
    lib = tmp_path / "music"
    lib.mkdir()
    make_wav(lib / "A - One.wav")
    (lib / "A - One.lrc").write_text("[00:00.10] hallo\n[00:01.00] welt", encoding="utf-8")
    api.put("/api/settings", json={**api.get("/api/settings").json(), "library_dirs": [str(lib)]})
    api.post("/api/library/scan")
    song = api.get("/api/songs").json()[0]
    assert song["lyrics_status"] == "found" and lrclib.calls == []
    assert api.get(f"/api/songs/{song['id']}/lyrics").json()["source"] == "sidecar"


def test_lrclib_down_keeps_song_pending(api, lrclib, tmp_path):
    lrclib.status = 503
    s = add_song(api, tmp_path)
    assert status(api, s["id"]) == "pending"
    d = api.post(f"/api/songs/{s['id']}/lyrics/discover").json()
    assert d["status"] == "pending" and d["error"]
    assert api.get(f"/api/songs/{s['id']}/lyrics/search", params={"q": "x"}).status_code == 502


def test_attaching_new_lyrics_keeps_old_row_inactive(api, lrclib, tmp_path):
    lrclib.get_result = lrclib_json()
    s = add_song(api, tmp_path)
    first = api.get(f"/api/songs/{s['id']}/lyrics").json()["id"]
    second = api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("x.lrc", b"[00:01.00] neu", "text/plain")}).json()["id"]
    assert second != first and api.get(f"/api/songs/{s['id']}/lyrics").json()["id"] == second


def test_cache_prevents_second_lrclib_call_and_can_be_cleared(api, lrclib, tmp_path):
    s = add_song(api, tmp_path)
    n = len(lrclib.calls)
    api.post(f"/api/songs/{s['id']}/lyrics/discover")
    assert len(lrclib.calls) == n  # served from cache (even the 'nothing found' answers)
    assert api.delete("/api/lyrics/cache").json()["deleted"] >= 1
    api.post(f"/api/songs/{s['id']}/lyrics/discover")
    assert len(lrclib.calls) > n


def test_cache_ttl_setting_is_respected(api, lrclib, tmp_path):
    api.put("/api/settings", json={**api.get("/api/settings").json(), "lyrics_cache_ttl_days": 0})
    s = add_song(api, tmp_path)
    assert api.get("/api/settings").json()["lyrics_cache_ttl_days"] == 0
    n = len(lrclib.calls)
    api.post(f"/api/songs/{s['id']}/lyrics/discover")
    assert len(lrclib.calls) == n


def test_background_discovery_never_overrides_lyrics_attached_meanwhile(api, lrclib, tmp_path, session):
    """The user uploads lyrics while the (slow) background lookup is still running."""
    from sqlalchemy.orm import sessionmaker

    from app.db.models import Lyrics, LyricsSource, Song
    from app.services.lyrics.background import discover_for_songs

    s = add_song(api, tmp_path)  # background run: nothing found → not_found
    assert status(api, s["id"]) == "not_found"
    up = api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("x.lrc", b"[00:01.00] hallo welt", "text/plain")})
    assert up.status_code == 201 and status(api, s["id"]) == "found"
    # a late background run (e.g. a rescan) must leave the status alone and not call LRCLIB for it
    calls = len(lrclib.calls)
    discover_for_songs(sessionmaker(bind=session.get_bind(), expire_on_commit=False), lrclib.client(), [s["id"]])
    assert status(api, s["id"]) == "found" and len(lrclib.calls) == calls


def test_searching_again_never_downgrades_a_song_that_has_lyrics(api, lrclib, tmp_path):
    s = add_song(api, tmp_path)
    api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("x.lrc", b"[00:01.00] hallo welt", "text/plain")})
    d = api.post(f"/api/songs/{s['id']}/lyrics/discover").json()  # explicit search finds nothing better
    assert d["status"] == "not_found"
    assert status(api, s["id"]) == "found"
