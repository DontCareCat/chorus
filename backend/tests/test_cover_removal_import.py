import base64
from pathlib import Path
from types import SimpleNamespace

import pytest
from mutagen.flac import Picture
from mutagen.id3 import APIC
from mutagen.mp4 import MP4Cover
from mutagen.wave import WAVE

from app.core.config import settings as env
from app.services.library import tags as tags_mod
from app.services.library.tags import extract_cover
from tests.conftest import make_wav
from tests.test_api_library import upload

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 20


def wav_with_cover(path: Path, data: bytes = PNG, seed: int = 0, mime: str = "image/png") -> Path:
    make_wav(path, seed=seed)
    w = WAVE(str(path))
    w.add_tags()
    w.tags.add(APIC(encoding=3, mime=mime, type=3, desc="", data=data))
    w.save()
    return path


def make_mp3(path: Path, cover: bytes | None = None) -> Path:
    from mutagen.id3 import ID3

    path.write_bytes((b"\xff\xfb\x90\x00" + b"\x00" * 413) * 20)  # 20 valid MPEG-1 Layer III frames
    if cover:
        tags = ID3()
        tags.add(APIC(encoding=3, mime="image/png", type=3, desc="", data=cover))
        tags.save(str(path))
    return path


# ---------- cover extraction ----------
def test_extract_cover_from_id3_in_wav_and_mp3(tmp_path):
    assert extract_cover(wav_with_cover(tmp_path / "a.wav")) == (PNG, "image/png")
    assert extract_cover(make_mp3(tmp_path / "b.mp3", PNG)) == (PNG, "image/png")


def test_no_cover_and_non_audio_give_none(tmp_path):
    assert extract_cover(make_wav(tmp_path / "plain.wav")) is None
    assert extract_cover(make_mp3(tmp_path / "plain.mp3")) is None
    junk = tmp_path / "x.mp3"
    junk.write_bytes(b"not audio")
    assert extract_cover(junk) is None


def test_mime_comes_from_the_bytes_not_the_tag(tmp_path):
    p = wav_with_cover(tmp_path / "a.wav", data=JPEG, mime="image/png")  # tag lies
    assert extract_cover(p) == (JPEG, "image/jpeg")


def test_non_image_data_in_the_picture_field_is_rejected(tmp_path):
    assert extract_cover(wav_with_cover(tmp_path / "a.wav", data=b"<script>alert(1)</script>")) is None


def test_front_cover_preferred_over_other_pictures():
    other = SimpleNamespace(type=4, data=JPEG)
    front = SimpleNamespace(type=3, data=PNG)
    assert tags_mod._front([other, front]) is front
    assert tags_mod._front([other]) is other
    assert tags_mod._front([]) is None


@pytest.mark.parametrize("kind", ["flac", "mp4", "vorbis"])
def test_other_formats_are_read_through_their_own_tag_layouts(monkeypatch, tmp_path, kind):
    """No encoder is available to build FLAC/M4A/Ogg files, so emulate what mutagen returns for each."""
    pic = Picture()
    pic.type, pic.mime, pic.data = 3, "image/png", PNG
    if kind == "flac":
        fake = SimpleNamespace(pictures=[pic], tags=None)
    elif kind == "mp4":
        fake = SimpleNamespace(pictures=None, tags={"covr": [MP4Cover(PNG, imageformat=MP4Cover.FORMAT_PNG)]})
    else:
        block = base64.b64encode(pic.write()).decode()
        fake = SimpleNamespace(pictures=None, tags={"metadata_block_picture": [block]})
    monkeypatch.setattr(tags_mod.mutagen, "File", lambda *a, **k: fake)
    assert extract_cover(tmp_path / "x") == (PNG, "image/png")


# ---------- cover endpoint ----------
def test_cover_endpoint_and_has_cover_flag(api, tmp_path):
    with_cover = upload(api, wav_with_cover(tmp_path / "A - With.wav", seed=1)).json()
    without = upload(api, make_wav(tmp_path / "B - Without.wav", seed=2)).json()
    assert with_cover["has_cover"] is True and without["has_cover"] is False
    r = api.get(f"/api/songs/{with_cover['id']}/cover")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content == PNG
    assert "max-age" in r.headers["cache-control"]
    miss = api.get(f"/api/songs/{without['id']}/cover")
    assert miss.status_code == 404 and miss.json()["error"]["code"] == "no_cover"


def test_has_cover_unknown_is_resolved_on_first_request(api, tmp_path, session):
    from app.db.models import Song

    s = upload(api, wav_with_cover(tmp_path / "A - With.wav")).json()
    session.query(Song).filter_by(id=s["id"]).update({"has_cover": None})  # e.g. a song from before covers existed
    session.commit()
    assert [x["has_cover"] for x in api.get("/api/songs").json()] == [None]
    assert api.get(f"/api/songs/{s['id']}/cover").status_code == 200
    assert api.get("/api/songs").json()[0]["has_cover"] is True


# ---------- removal ----------
def test_removing_an_uploaded_song_deletes_everything_including_the_stored_copy(api, tmp_path):
    s = upload(api, make_wav(tmp_path / "Band - Lied.wav", seconds=30)).json()
    api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("l.lrc", b"[00:01.00] Ich gehe jeden Morgen zur Arbeit\n[00:06.00] Wir fahren mit dem Zug zum Bahnhof\n[00:11.00] Die Sonne scheint ueber der Stadt", "text/plain")})
    g = api.post("/api/games", json={"song_id": s["id"], "difficulty": "medium"}).json()
    media = Path(env.media_dir)
    assert len(list(media.glob("*.wav"))) == 1
    r = api.delete(f"/api/songs/{s['id']}")
    assert r.status_code == 200 and r.json() == {"result": "deleted"}
    assert api.get("/api/songs").json() == []
    assert list(media.glob("*.wav")) == []
    assert api.get(f"/api/games/{g['public_id']}").status_code == 404 or api.get(f"/api/songs/{s['id']}/audio").status_code == 404
    assert api.get(f"/api/songs/{s['id']}/audio").status_code == 404
    assert api.delete(f"/api/songs/{s['id']}").status_code == 404
    # the same file can be added again afterwards
    assert upload(api, tmp_path / "Band - Lied.wav").status_code == 201


def test_removing_a_library_song_only_hides_it_and_never_touches_the_file(api, tmp_path):
    lib = tmp_path / "music"
    lib.mkdir()
    f = make_wav(lib / "A - One.wav", seed=1)
    api.put("/api/settings", json={**api.get("/api/settings").json(), "library_dirs": [str(lib)]})
    api.post("/api/library/scan")
    song = api.get("/api/songs").json()[0]
    assert api.delete(f"/api/songs/{song['id']}").json() == {"result": "hidden"}
    assert f.exists()  # the user's own file is untouched
    assert api.get("/api/songs").json() == []
    assert api.post("/api/library/scan").json()["added"] == 0  # a rescan does not bring it back
    assert api.get("/api/songs").json() == []
    assert api.get(f"/api/songs/{song['id']}/audio").status_code == 404
    # adding it again on purpose (import) restores it
    r = api.post("/api/library/import", json={"path": str(f), "recursive": False})
    assert r.status_code == 200
    assert [s["id"] for s in api.get("/api/songs").json()] == [song["id"]]


# ---------- directory import ----------
@pytest.fixture
def tree(tmp_path):
    root = tmp_path / "albums"
    (root / "one" / "deep").mkdir(parents=True)
    (root / "two").mkdir()
    make_wav(root / "A - Top.wav", seed=1)
    make_wav(root / "one" / "B - Mid.wav", seed=2)
    make_wav(root / "one" / "deep" / "C - Deep.wav", seed=3)
    make_wav(root / "two" / "D - Other.wav", seed=4)
    (root / "one" / "cover.jpg").write_bytes(JPEG)
    (root / "notes.txt").write_text("not music")
    return root


def titles(api):
    return sorted(s["title"] for s in api.get("/api/songs").json())


def test_directory_import_recursive_uses_files_in_place(api, tree):
    r = api.post("/api/library/import", json={"path": str(tree), "recursive": True}).json()
    assert (r["added"], r["skipped"], r["errors"]) == (4, 0, [])
    assert titles(api) == ["Deep", "Mid", "Other", "Top"]
    assert {s["source"] for s in api.get("/api/songs").json()} == {"library"}
    assert list(Path(env.media_dir).glob("*")) == []  # nothing was copied


def test_directory_import_without_recursion_stays_in_the_top_folder(api, tree):
    r = api.post("/api/library/import", json={"path": str(tree), "recursive": False}).json()
    assert r["added"] == 1 and titles(api) == ["Top"]


def test_directory_import_can_copy_files_into_storage(api, tree):
    r = api.post("/api/library/import", json={"path": str(tree), "recursive": True, "copy_files": True}).json()
    assert r["added"] == 4
    assert {s["source"] for s in api.get("/api/songs").json()} == {"import"}
    assert len(list(Path(env.media_dir).glob("*.wav"))) == 4
    assert all(p.exists() for p in tree.rglob("*.wav"))  # originals untouched


def test_directory_import_is_repeatable_and_reports_bad_files(api, tree):
    api.post("/api/library/import", json={"path": str(tree)})
    again = api.post("/api/library/import", json={"path": str(tree)}).json()
    assert (again["added"], again["skipped"]) == (0, 4)
    (tree / "broken.mp3").write_bytes(b"garbage")
    r = api.post("/api/library/import", json={"path": str(tree)}).json()
    assert r["added"] == 0 and len(r["errors"]) == 1 and "broken.mp3" in r["errors"][0]


def test_import_accepts_a_single_file_and_rejects_bad_paths(api, tree, tmp_path):
    ok = api.post("/api/library/import", json={"path": str(tree / "A - Top.wav")}).json()
    assert ok["added"] == 1
    assert api.post("/api/library/import", json={"path": "relative/dir"}).json()["error"]["code"] == "invalid_path"
    assert api.post("/api/library/import", json={"path": str(tmp_path / "missing")}).status_code == 400
    assert api.post("/api/library/import", json={"path": str(tree / "notes.txt")}).json()["error"]["code"] == "unsupported_audio"


def test_directory_import_does_not_follow_symlinks_out_of_the_folder(api, tree, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    make_wav(outside / "X - Secret.wav", seed=9)
    (tree / "link").symlink_to(outside, target_is_directory=True)
    (tree / "filelink.wav").symlink_to(outside / "X - Secret.wav")
    api.post("/api/library/import", json={"path": str(tree)})
    assert titles(api) == ["Deep", "Mid", "Other", "Top"]  # neither "filelink" nor the contents of "link/"


def test_removing_an_imported_copy_never_deletes_the_original(api, tree):
    api.post("/api/library/import", json={"path": str(tree), "recursive": False, "copy_files": True})
    song = api.get("/api/songs").json()[0]
    assert api.delete(f"/api/songs/{song['id']}").json() == {"result": "deleted"}
    assert (tree / "A - Top.wav").exists()
    assert list(Path(env.media_dir).glob("*.wav")) == []


def test_a_removed_song_stays_hidden_even_if_its_file_turns_up_under_another_path(api, tmp_path):
    lib = tmp_path / "music"
    lib.mkdir()
    f = make_wav(lib / "A - One.wav", seed=1)
    api.put("/api/settings", json={**api.get("/api/settings").json(), "library_dirs": [str(lib)]})
    api.post("/api/library/scan")
    api.delete(f"/api/songs/{api.get('/api/songs').json()[0]['id']}")
    f.rename(lib / "A - One (renamed).wav")  # same bytes, new path: found by hash, not by path
    assert api.post("/api/library/scan").json()["added"] == 0
    assert api.get("/api/songs").json() == []


def test_delete_only_removes_files_inside_the_current_media_folder(api, tmp_path, monkeypatch):
    s = upload(api, make_wav(tmp_path / "Band - Lied.wav")).json()
    stored = next(Path(env.media_dir).glob("*.wav"))
    monkeypatch.setattr(env, "media_dir", str(tmp_path / "somewhere-else"))  # e.g. MEDIA_DIR was changed later
    assert api.delete(f"/api/songs/{s['id']}").json() == {"result": "deleted"}
    assert stored.exists()  # not ours to delete any more
