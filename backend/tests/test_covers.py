from pathlib import Path

import pytest

from app.api.deps import get_cover_client
from app.main import app
from app.services.library import covers as covers_service
from app.services.library.covers import CoverClient, CoverUnavailable
from tests.conftest import PNG, make_wav, release
from tests.test_api_library import upload
from tests.test_cover_removal_import import wav_with_cover

ALBUM_IMAGE = PNG + b"album"


def recording(releases, score=100):
    return {"score": score, "releases": releases}


def song_without_cover(api, tmp_path, name="Rammstein - Du hast.wav", seed=0):
    return upload(api, make_wav(tmp_path / name, 2.0, seed)).json()


def song_row(api, song_id):
    return next(s for s in api.get("/api/songs").json() if s["id"] == song_id)


# ---------- automatic lookup after a song is added ----------
def test_a_confident_match_is_saved_by_itself_outside_the_music_folders(api, covers, tmp_path):
    covers.recordings = [recording([release("m1", "Sehnsucht")])]
    covers.images["m1"] = ALBUM_IMAGE
    s = song_without_cover(api, tmp_path)
    row = song_row(api, s["id"])
    assert row["has_cover"] is True and row["cover_source"] == "online"
    saved = tmp_path / "covers" / f"{s['id']}.png"
    assert saved.read_bytes() == ALBUM_IMAGE
    assert (tmp_path / "media") not in saved.parents  # kept in its own folder, not with the songs
    r = api.get(f"/api/songs/{s['id']}/cover")
    assert r.status_code == 200 and r.content == ALBUM_IMAGE and r.headers["content-type"] == "image/png"
    assert r.headers["cache-control"] == "no-cache"  # a replaced cover shows at once


def test_reissues_of_the_same_album_count_as_one_match(api, covers, tmp_path):
    covers.recordings = [recording([release("m1", "Sehnsucht", date="1997"), release("m2", "Sehnsucht", date="2012"), release("m3", "SEHNSUCHT")])]
    covers.images["m2"] = ALBUM_IMAGE  # the first release has no image: the next one is tried
    s = song_without_cover(api, tmp_path)
    assert song_row(api, s["id"])["cover_source"] == "online"
    assert covers.calls.count("caa:/release/m1/front-500") == 1 and "caa:/release/m2/front-500" in covers.calls


def test_different_albums_are_not_guessed_the_person_chooses(api, covers, tmp_path):
    covers.recordings = [recording([release("m1", "Sehnsucht"), release("m2", "Live aus Berlin")])]
    covers.images = {"m1": ALBUM_IMAGE, "m2": ALBUM_IMAGE + b"2"}
    s = song_without_cover(api, tmp_path)
    row = song_row(api, s["id"])
    assert row["cover_source"] == "choose" and row["has_cover"] is not True
    assert api.get(f"/api/songs/{s['id']}/cover").status_code == 404
    found = api.get(f"/api/songs/{s['id']}/cover/candidates").json()
    assert {c["title"] for c in found} == {"Sehnsucht", "Live aus Berlin"} and set(found[0]) == {"id", "title", "artist", "date", "score"}
    thumb = api.get(f"/api/songs/{s['id']}/cover/candidates/m2/image")
    assert thumb.status_code == 200 and thumb.content == ALBUM_IMAGE + b"2"
    chosen = api.post(f"/api/songs/{s['id']}/cover/choose", json={"id": "m2"}).json()
    assert chosen["cover_source"] == "online" and chosen["has_cover"] is True
    assert api.get(f"/api/songs/{s['id']}/cover").content == ALBUM_IMAGE + b"2"


def test_a_weak_match_or_another_artist_is_not_trusted(api, covers, tmp_path):
    covers.recordings = [recording([release("m1", "Sehnsucht", score=60)], score=60)]
    covers.images["m1"] = ALBUM_IMAGE
    assert song_row(api, song_without_cover(api, tmp_path)["id"])["cover_source"] == "choose"
    covers.recordings = [recording([release("m9", "Other", artist="Someone Else")])]
    covers.images["m9"] = ALBUM_IMAGE
    s2 = song_without_cover(api, tmp_path, "Band - Other.wav", seed=1)
    assert song_row(api, s2["id"])["cover_source"] == "choose" and song_row(api, s2["id"])["has_cover"] is not True


def test_a_miss_is_remembered_and_only_retried_by_hand(api, covers, tmp_path):
    s = song_without_cover(api, tmp_path)
    assert song_row(api, s["id"])["cover_source"] == "none"
    calls = len(covers.calls)
    api.get("/api/songs")  # nothing asks again by itself
    assert len(covers.calls) == calls
    covers.recordings = [recording([release("m1", "Sehnsucht")])]
    covers.images["m1"] = ALBUM_IMAGE
    assert api.post(f"/api/songs/{s['id']}/cover/auto").json() == {"status": "online"}
    assert song_row(api, s["id"])["has_cover"] is True


def test_the_album_tag_is_used_when_there_is_one(api, covers, tmp_path):
    s = song_without_cover(api, tmp_path)
    api.patch(f"/api/songs/{s['id']}", json={"album": "Mutter"})
    covers.releases = [release("a1", "Mutter"), release("a2", "Mutter (Deluxe)", score=90)]
    covers.images["a1"] = ALBUM_IMAGE
    assert api.post(f"/api/songs/{s['id']}/cover/auto").json()["status"] == "online"
    assert any(c == "mb:/ws/2/release" or c.endswith("/release") for c in covers.calls)


def test_embedded_art_wins_and_no_lookup_happens(api, covers, tmp_path):
    s = upload(api, wav_with_cover(tmp_path / "Band - With.wav", seed=5)).json()
    assert s["has_cover"] is True and covers.calls == []
    assert api.get(f"/api/songs/{s['id']}/cover").status_code == 200
    assert song_row(api, s["id"])["cover_source"] == "embedded"


def test_the_setting_turns_the_lookup_off(api, covers, tmp_path):
    api.put("/api/settings", json={**api.get("/api/settings").json(), "auto_fetch_covers": False})
    covers.recordings = [recording([release("m1", "Sehnsucht")])]
    covers.images["m1"] = ALBUM_IMAGE
    s = song_without_cover(api, tmp_path)
    assert covers.calls == [] and song_row(api, s["id"])["cover_source"] is None


# ---------- failures ----------
def test_a_server_error_is_retried_and_then_reported(api, covers, tmp_path):
    s = song_without_cover(api, tmp_path)
    covers.status = 503
    r = api.post(f"/api/songs/{s['id']}/cover/auto")
    assert r.status_code == 502 and r.json()["error"]["code"] == "covers_unavailable"
    assert covers.calls.count("mb:/ws/2/recording") >= 3  # tried 3 times
    assert api.get(f"/api/songs/{s['id']}/cover/candidates").status_code == 502


def test_the_background_lookup_never_breaks_adding_a_song(api, covers, tmp_path):
    covers.status = 500
    s = song_without_cover(api, tmp_path)  # MusicBrainz is down: the song is still added
    assert song_row(api, s["id"])["title"] == "Du hast"


def test_something_that_is_not_an_image_is_never_stored(api, covers, tmp_path):
    covers.recordings = [recording([release("m1", "Sehnsucht")])]
    covers.images["m1"] = b"<html>not an image</html>"
    s = song_without_cover(api, tmp_path)
    assert song_row(api, s["id"])["has_cover"] is not True
    assert list((tmp_path / "covers").glob("*")) == []
    assert api.post(f"/api/songs/{s['id']}/cover/choose", json={"id": "m1"}).status_code == 404
    assert api.post(f"/api/songs/{s['id']}/cover/choose", json={"id": "../etc"}).status_code == 400
    assert api.get(f"/api/songs/{s['id']}/cover/candidates/..%2Fx/image").status_code in (400, 404)


# ---------- own image, removal ----------
def test_upload_replace_and_remove_a_cover(api, covers, tmp_path):
    s = song_without_cover(api, tmp_path)
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 40
    r = api.post(f"/api/songs/{s['id']}/cover/upload", files={"file": ("c.jpg", jpeg, "image/jpeg")})
    assert r.status_code == 200 and r.json()["cover_source"] == "custom"
    assert api.get(f"/api/songs/{s['id']}/cover").content == jpeg
    api.post(f"/api/songs/{s['id']}/cover/upload", files={"file": ("c.png", ALBUM_IMAGE, "image/png")})
    assert [p.name for p in (tmp_path / "covers").glob("*")] == [f"{s['id']}.png"]  # the old file was replaced, not kept
    assert api.post(f"/api/songs/{s['id']}/cover/upload", files={"file": ("x.txt", b"hello", "text/plain")}).status_code == 422
    gone = api.delete(f"/api/songs/{s['id']}/cover").json()
    assert gone["has_cover"] is False and gone["cover_source"] is None
    assert list((tmp_path / "covers").glob("*")) == [] and api.get(f"/api/songs/{s['id']}/cover").status_code == 404


def test_removing_the_song_keeps_the_covers_folder_tidy_or_at_least_safe(api, covers, tmp_path):
    covers.recordings = [recording([release("m1", "Sehnsucht")])]
    covers.images["m1"] = ALBUM_IMAGE
    s = song_without_cover(api, tmp_path)
    assert api.delete(f"/api/songs/{s['id']}").status_code == 200
    assert api.get(f"/api/songs/{s['id']}/cover").status_code == 404


# ---------- the client ----------
def test_requests_to_musicbrainz_are_spaced_out():
    import httpx

    now = [0.0]
    sleeps: list[float] = []

    def sleep(s):
        sleeps.append(round(s, 2))
        now[0] += s

    mb = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"releases": []})), base_url="https://mb.test")
    client = CoverClient(mb, httpx.Client(base_url="https://c.test"), sleep=sleep, clock=lambda: now[0], min_gap=1.1)
    client.search("Band", "Album", "T")
    client.search("Band", "Album", "T")
    client.search("Band", "Album", "T")
    assert sleeps == [1.1, 1.1]  # the first goes at once, every later one waits for the gap


def test_covers_folder_defaults_next_to_the_media_folder(monkeypatch, tmp_path):
    monkeypatch.setattr(covers_service.settings, "covers_dir", "")
    monkeypatch.setattr(covers_service.settings, "media_dir", str(tmp_path / "data" / "media"))
    assert covers_service.covers_dir() == (tmp_path / "data" / "covers").resolve()
    monkeypatch.setattr(covers_service.settings, "covers_dir", str(tmp_path / "elsewhere"))
    assert covers_service.covers_dir() == tmp_path / "elsewhere"
