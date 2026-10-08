from pathlib import Path

from tests.conftest import make_wav


def upload(api, path: Path, name: str | None = None):
    with path.open("rb") as f:
        return api.post("/api/songs", files={"file": (name or path.name, f, "audio/wav")})


def test_upload_reads_tags_dedupes_and_streams(api, tmp_path):
    wav = make_wav(tmp_path / "Rammstein - Du hast.wav", seconds=2)
    r = upload(api, wav)
    assert r.status_code == 201
    s = r.json()
    assert (s["artist"], s["title"], s["source"]) == ("Rammstein", "Du hast", "upload")
    assert abs(s["duration"] - 2.0) < 0.05
    assert upload(api, wav).json()["id"] == s["id"]  # same content → same song
    assert len(api.get("/api/songs").json()) == 1
    audio = api.get(f"/api/songs/{s['id']}/audio", headers={"Range": "bytes=0-99"})
    assert audio.status_code == 206 and len(audio.content) == 100


def test_upload_rejects_non_audio(api, tmp_path):
    bad = tmp_path / "x.mp3"
    bad.write_bytes(b"not audio at all")
    r = upload(api, bad)
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_audio"
    txt = tmp_path / "x.txt"
    txt.write_text("hi")
    assert upload(api, txt).json()["error"]["code"] == "unsupported_audio"


def test_import_copies_into_media_dir(api, tmp_path):
    wav = make_wav(tmp_path / "Artist - Title.wav")
    r = api.post("/api/songs/import", json={"path": str(wav)})
    assert r.status_code == 201 and r.json()["source"] == "import"
    assert api.post("/api/songs/import", json={"path": "relative.wav"}).json()["error"]["code"] == "invalid_path"
    assert api.post("/api/songs/import", json={"path": str(tmp_path / "missing.wav")}).status_code == 400


def test_scan_discovers_in_place_and_tracks_availability(api, tmp_path):
    lib = tmp_path / "music"
    (lib / "sub").mkdir(parents=True)
    a = make_wav(lib / "A - One.wav", seed=1)
    make_wav(lib / "sub" / "B - Two.wav", seed=2)
    (lib / "notes.txt").write_text("ignore")
    api.put("/api/settings", json={"library_dirs": [str(lib), str(tmp_path / "nope")]})
    r = api.post("/api/library/scan").json()
    assert (r["added"], r["skipped"]) == (2, 0) and len(r["errors"]) == 1
    songs = api.get("/api/songs").json()
    assert {s["source"] for s in songs} == {"library"}
    assert api.post("/api/library/scan").json()["added"] == 0  # idempotent
    a.unlink()
    r = api.post("/api/library/scan").json()
    assert r["unavailable"] == 1
    assert sorted(s["available"] for s in api.get("/api/songs").json()) == [False, True]


def test_scan_relinks_moved_file(api, tmp_path):
    lib = tmp_path / "music"
    lib.mkdir()
    f = make_wav(lib / "A - One.wav", seed=1)
    api.put("/api/settings", json={"library_dirs": [str(lib)]})
    api.post("/api/library/scan")
    f.rename(lib / "A - One (moved).wav")
    r = api.post("/api/library/scan").json()
    songs = api.get("/api/songs").json()
    assert len(songs) == 1 and songs[0]["available"] and r["added"] == 0


def test_patch_song(api, tmp_path):
    s = upload(api, make_wav(tmp_path / "A - B.wav")).json()
    r = api.patch(f"/api/songs/{s['id']}", json={"language": "fr", "lyrics_offset": -0.5}).json()
    assert r["language"] == "fr" and r["lyrics_offset"] == -0.5
    assert api.patch(f"/api/songs/{s['id']}", json={"lyrics_offset": 999}).status_code == 422
    assert api.get("/api/songs/999/audio").status_code == 404


def test_settings_roundtrip_and_validation(api):
    d = api.get("/api/settings").json()
    assert d["allow_unsynchronized_lyrics"] is False and d["lyrics_cache_ttl_days"] == 30
    d["allow_unsynchronized_lyrics"] = True
    d["lyrics_cache_ttl_days"] = 0
    assert api.put("/api/settings", json=d).json()["lyrics_cache_ttl_days"] == 0
    assert api.get("/api/settings").json()["allow_unsynchronized_lyrics"] is True
    d["lyrics_cache_ttl_days"] = -1
    assert api.put("/api/settings", json=d).status_code == 422
