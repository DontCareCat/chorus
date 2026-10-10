import os
import sys

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings as env
from app.main import app
from app.services.library.fs import MAX_PATTERN, name_filter
from tests.conftest import make_wav
from tests.test_accounts import sign_up


@pytest.fixture
def tree(tmp_path):
    root = tmp_path / "music"
    (root / "sub" / "deep").mkdir(parents=True)
    (root / ".hidden").mkdir()
    make_wav(root / "Alpha - One.wav", 2.0, 1)
    make_wav(root / "Beta - Two (live).wav", 2.0, 2)
    make_wav(root / "sub" / "Gamma - Three.wav", 2.0, 3)
    make_wav(root / "sub" / "deep" / "Delta - Four (live).wav", 2.0, 4)
    make_wav(root / ".hidden" / "Secret - Five.wav", 2.0, 5)
    (root / "notes.txt").write_text("not audio")
    return root


def remote(api) -> TestClient:
    """A client from another computer (same app and database as `api`)."""
    return TestClient(app, client=("192.168.1.50", 40000))


# ---------- listing ----------
def test_listing_shows_folders_then_audio_files_only(api, tree):
    r = api.get("/api/fs/list", params={"path": str(tree)}).json()
    assert r["path"] == str(tree.resolve()) and r["parent"] == str(tree.resolve().parent)
    assert [(e["name"], e["kind"]) for e in r["entries"]] == [("sub", "dir"), ("Alpha - One.wav", "audio"), ("Beta - Two (live).wav", "audio")]
    assert all(e["size"] is None for e in r["entries"] if e["kind"] == "dir") and all(e["size"] > 0 for e in r["entries"] if e["kind"] == "audio")
    assert not any(e["name"] == "notes.txt" for e in r["entries"])  # not audio: not listed
    hidden = api.get("/api/fs/list", params={"path": str(tree), "hidden": True}).json()
    assert ".hidden" in [e["name"] for e in hidden["entries"]]


def test_listing_defaults_to_home_and_offers_places_to_start(api, tmp_path, monkeypatch):
    lib = tmp_path / "library"
    lib.mkdir()
    api.put("/api/settings", json={**api.get("/api/settings").json(), "library_dirs": [str(lib)]})
    r = api.get("/api/fs/list").json()
    assert r["path"] == str(os.path.realpath(os.path.expanduser("~")))
    assert r["roots"][0]["name"] == "Home" and {"name": "library", "path": str(lib)} in r["roots"]
    assert len({x["path"] for x in r["roots"]}) == len(r["roots"])  # no duplicates


def test_listing_errors_say_what_is_wrong(api, tree, tmp_path):
    assert api.get("/api/fs/list", params={"path": "relative/dir"}).json()["error"]["code"] == "invalid_path"
    assert api.get("/api/fs/list", params={"path": str(tmp_path / "nope")}).status_code == 404
    r = api.get("/api/fs/list", params={"path": str(tree / "Alpha - One.wav")})
    assert r.status_code == 400 and r.json()["error"]["code"] == "not_a_folder"


@pytest.mark.skipif(sys.platform == "win32" or os.geteuid() == 0, reason="needs a normal user")
def test_a_folder_that_may_not_be_opened_is_reported(api, tree):
    locked = tree / "locked"
    locked.mkdir()
    locked.chmod(0)
    try:
        r = api.get("/api/fs/list", params={"path": str(locked)})
        assert r.status_code == 403 and r.json()["error"]["code"] == "path_forbidden"
    finally:
        locked.chmod(0o755)


@pytest.mark.skipif(sys.platform == "win32", reason="symlinks")
def test_links_are_marked_and_broken_ones_left_out(api, tree, tmp_path):
    os.symlink(tree / "sub", tree / "shortcut")
    os.symlink(tmp_path / "gone", tree / "dangling")
    entries = {e["name"]: e for e in api.get("/api/fs/list", params={"path": str(tree)}).json()["entries"]}
    assert entries["shortcut"]["link"] is True and entries["shortcut"]["kind"] == "dir"
    assert "dangling" not in entries


# ---------- who may do it ----------
def test_only_this_machine_or_the_administrator_may_browse_and_import_by_path(api, tree):
    other = remote(api)
    for call in (
        lambda c: c.get("/api/fs/list", params={"path": str(tree)}),
        lambda c: c.post("/api/library/import-many", json={"paths": [str(tree)]}),
        lambda c: c.post("/api/library/import", json={"path": str(tree)}),
        lambda c: c.post("/api/songs/import", json={"path": str(tree / "Alpha - One.wav")}),
    ):
        r = call(other)
        assert r.status_code == 403 and r.json()["error"]["code"] == "path_access_denied"
    assert api.get("/api/songs").status_code == 200 and other.get("/api/songs").status_code == 200  # the rest is open to guests


def test_the_administrator_may_do_it_from_anywhere(api, tree):
    sign_up(api, "boss")  # first account = administrator; the browser keeps the session cookie
    cookie = api.cookies.get("chorus_session")
    other = remote(api)
    other.cookies.set("chorus_session", cookie)
    assert other.get("/api/fs/list", params={"path": str(tree)}).status_code == 200
    bob = remote(api)
    bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"})
    assert bob.get("/api/fs/list", params={"path": str(tree)}).status_code == 403  # an ordinary account is not enough


def test_a_proxy_in_front_does_not_make_everybody_local(api, tree):
    r = api.get("/api/fs/list", params={"path": str(tree)}, headers={"X-Forwarded-For": "203.0.113.9"})
    assert r.status_code == 403


def test_path_access_can_be_opened_for_a_trusted_network(api, tree, monkeypatch):
    monkeypatch.setattr(env, "path_access", "open")
    assert remote(api).get("/api/fs/list", params={"path": str(tree)}).status_code == 200


# ---------- importing several things at once ----------
def songs(api):
    return sorted(s["file_name"] for s in api.get("/api/songs").json())


def test_import_a_folder_and_single_files_in_one_go(api, tree):
    r = api.post("/api/library/import-many", json={"paths": [str(tree / "sub"), str(tree / "Alpha - One.wav")], "recursive": True}).json()
    assert (r["added"], r["skipped"], r["errors"]) == (3, 0, [])
    assert songs(api) == ["Alpha - One.wav", "Delta - Four (live).wav", "Gamma - Three.wav"]
    again = api.post("/api/library/import-many", json={"paths": [str(tree)]}).json()  # everything, some already known
    assert again["added"] == 2 and again["skipped"] == 3  # Beta and the file in the hidden folder (a folder import walks everything)


def test_without_subfolders_only_the_top_level_is_taken(api, tree):
    r = api.post("/api/library/import-many", json={"paths": [str(tree)], "recursive": False}).json()
    assert songs(api) == ["Alpha - One.wav", "Beta - Two (live).wav"] and r["added"] == 2


def test_the_same_path_twice_and_overlapping_choices_count_once(api, tree):
    r = api.post("/api/library/import-many", json={"paths": [str(tree / "sub"), str(tree / "sub"), str(tree / "sub" / "Gamma - Three.wav")]}).json()
    assert r["added"] == 2 and r["skipped"] == 1  # Gamma was inside the folder already


def test_bad_paths_are_reported_without_stopping_the_rest(api, tree, tmp_path):
    r = api.post("/api/library/import-many", json={"paths": [str(tmp_path / "missing"), str(tree / "notes.txt"), "relative.wav", str(tree / "Alpha - One.wav")]}).json()
    assert r["added"] == 1 and len(r["errors"]) == 3
    assert any("missing" in e for e in r["errors"]) and any("notes.txt" in e for e in r["errors"]) and any("relative.wav" in e for e in r["errors"])


def test_copy_into_storage_works_for_many(api, tree, tmp_path):
    api.post("/api/library/import-many", json={"paths": [str(tree / "sub")], "copy_files": True})
    stored = list((tmp_path / "media").rglob("*"))
    assert sum(1 for p in stored if p.is_file()) == 2
    assert {s["source"] for s in api.get("/api/songs").json()} == {"import"}


def test_an_empty_or_huge_list_is_refused(api):
    assert api.post("/api/library/import-many", json={"paths": []}).status_code == 422
    assert api.post("/api/library/import-many", json={"paths": ["/x"] * 501}).status_code == 422


# ---------- regular expressions on file names ----------
def test_include_pattern(api, tree):
    r = api.post("/api/library/import-many", json={"paths": [str(tree)], "include": r"\(live\)"}).json()
    assert songs(api) == ["Beta - Two (live).wav", "Delta - Four (live).wav"] and r["added"] == 2 and r["filtered"] == 3


def test_exclude_pattern(api, tree):
    api.post("/api/library/import-many", json={"paths": [str(tree)], "exclude": r"live|^Alpha"})
    assert "Gamma - Three.wav" in songs(api)
    assert not any("live" in n or n.startswith("Alpha") for n in songs(api))


def test_include_and_exclude_together_and_case_is_ignored(api, tree):
    api.post("/api/library/import-many", json={"paths": [str(tree)], "include": r"^(alpha|beta|gamma)", "exclude": r"LIVE"})
    assert songs(api) == ["Alpha - One.wav", "Gamma - Three.wav"]


def test_patterns_also_apply_to_the_single_folder_import_and_to_single_files(api, tree):
    r = api.post("/api/library/import", json={"path": str(tree), "include": r"^Beta"}).json()
    assert r["added"] == 1 and r["filtered"] == 4
    skipped = api.post("/api/library/import", json={"path": str(tree / "Alpha - One.wav"), "include": r"^Beta"}).json()
    assert skipped["added"] == 0 and skipped["filtered"] == 1  # a file you picked by hand obeys the filter too


def test_a_bad_pattern_is_refused_before_anything_is_imported(api, tree):
    for body in ({"include": "("}, {"exclude": "[a-"}, {"include": "x" * (MAX_PATTERN + 1)}):
        r = api.post("/api/library/import-many", json={"paths": [str(tree)], **body})
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_pattern", body
    assert songs(api) == []
    assert "regular expression" in api.post("/api/library/import", json={"path": str(tree), "include": "("}).json()["error"]["message"]


def test_name_filter_unit():
    assert name_filter(None, None) is None and name_filter("  ", "") is None
    f = name_filter("mp3$", "^bad")
    assert f("song.MP3") and not f("bad.mp3") and not f("song.wav")
    assert name_filter(".*", None)("a" * 1000)  # long names are cut before matching: cheap even for odd patterns
