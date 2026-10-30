import json
from pathlib import Path

import httpx
import pytest

from app.api.deps import get_spotify_client
from app.main import app
from app.services.spotify_page import SpotifyPageClient, parse_embed, parse_playlist_id

PID = "5auhc1NwZLVFKAfywWk5kN"
VID = "dQw4w9WgXcQ"


@pytest.mark.parametrize("text", [
    f"https://open.spotify.com/playlist/{PID}?si=mX5KiIeuTraB2m6EQfkJ7g&utm_source=copy-link&pi=nEHz3UtfQHWoo", f"https://open.spotify.com/playlist/{PID}",
    f"open.spotify.com/intl-de/playlist/{PID}", f"spotify:playlist:{PID}", f"  https://open.spotify.com/playlist/{PID}  ",
])
def test_parse_playlist_id(text):
    assert parse_playlist_id(text) == PID


@pytest.mark.parametrize("text", ["", "hello", f"https://example.com/playlist/{PID}", f"https://open.spotify.com/track/{PID}", "https://open.spotify.com/playlist/short"])
def test_parse_playlist_id_rejects(text):
    assert parse_playlist_id(text) is None


def embed_page(tracks, name="Mix", kind="playlist"):
    data = {"props": {"pageProps": {"state": {"data": {"entity": {"type": kind, "name": name, "subtitle": "Someone", "trackList": tracks}}}}}}
    return f'<html><script id="__NEXT_DATA__" type="application/json">{json.dumps(data)}</script></html>'


TRACKS = [
    {"uri": "spotify:track:t1", "title": "Du hast", "subtitle": "Rammstein", "duration": 2000},
    {"uri": "spotify:episode:e1", "title": "A podcast", "subtitle": "X", "duration": 1000},
    {"uri": "spotify:track:t2", "title": "99 Luftballons", "subtitle": "Nena", "duration": 233000},
]


def test_parse_embed_reads_tracks_and_skips_the_rest():
    p = parse_embed(embed_page(TRACKS))
    assert p is not None and p.name == "Mix" and p.owner == "Someone"
    assert [(t.title, t.artist, t.duration, t.spotify_id) for t in p.tracks] == [("Du hast", "Rammstein", 2.0, "t1"), ("99 Luftballons", "Nena", 233.0, "t2")]
    assert parse_embed("<html>nothing</html>") is None
    assert parse_embed(embed_page(TRACKS, kind="album")) is None


def test_parse_embed_reads_a_real_page():
    page = Path(__file__).with_name("fixtures_spotify_embed.html")
    p = parse_embed(page.read_text(encoding="utf8"))
    assert p is not None and p.name == "Deutsch lernen" and len(p.tracks) == 15 and p.tracks[0].artist == "Sportfreunde Stiller"


class FakeSpotify:
    def __init__(self):
        self.status = 200
        self.html = embed_page(TRACKS)

    def client(self) -> SpotifyPageClient:
        return SpotifyPageClient(httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(self.status, text=self.html))))


@pytest.fixture
def sp(api):
    fake = FakeSpotify()
    c = fake.client()
    app.dependency_overrides[get_spotify_client] = lambda: c
    return fake


def test_spotify_route_lists_tracks_with_library_matches(api, sp, tmp_path):
    from tests.conftest import make_wav
    with make_wav(tmp_path / "Rammstein - Du hast.wav", seconds=2).open("rb") as f:
        song = api.post("/api/songs", files={"file": ("Rammstein - Du hast.wav", f, "audio/wav")}).json()
    r = api.get("/api/spotify/playlist", params={"url": f"https://open.spotify.com/playlist/{PID}?si=abc"}).json()
    assert r["name"] == "Mix" and r["matched"] == 1
    assert [(t["title"], t["song_id"]) for t in r["tracks"]] == [("Du hast", song["id"]), ("99 Luftballons", None)]


def test_spotify_route_errors(api, sp):
    assert api.get("/api/spotify/playlist", params={"url": "https://example.com"}).json()["error"]["code"] == "bad_spotify_link"
    sp.status = 404
    assert api.get("/api/spotify/playlist", params={"url": f"spotify:playlist:{PID}"}).json()["error"]["code"] == "spotify_playlist_unavailable"
    sp.status = 503
    assert api.get("/api/spotify/playlist", params={"url": f"spotify:playlist:{PID}"}).status_code == 503
    sp.status = 200
    sp.html = "<html>the page changed</html>"
    assert api.get("/api/spotify/playlist", params={"url": f"spotify:playlist:{PID}"}).json()["error"]["code"] == "spotify_page_unreadable"


def test_import_gives_names_to_videos(api):
    from tests.test_youtube import FakeYouTube
    from app.api.deps import get_youtube_client
    fake = FakeYouTube()
    c = fake.client()
    app.dependency_overrides[get_youtube_client] = lambda: c
    r = api.post("/api/songs/youtube/import", json={"video_ids": [VID], "names": {VID: {"title": "Du hast", "artist": "Rammstein"}}}).json()
    assert (r["songs"][0]["title"], r["songs"][0]["artist"]) == ("Du hast", "Rammstein")


TRACK_PAGE = '<html><script id="__NEXT_DATA__" type="application/json">' + json.dumps({"props": {"pageProps": {"state": {"data": {"entity": {
    "type": "track", "name": "Du hast", "id": "t1", "artists": [{"name": "Rammstein"}, {"name": "Someone"}], "duration": 2000}}}}}}) + "</script></html>"


def test_spotify_track_link(api, sp, tmp_path):
    from tests.conftest import make_wav
    from app.services.spotify_page import parse_track_id
    assert parse_track_id("https://open.spotify.com/track/5QRkWkMabF6HJmQQm2HBVX?si=abc") == "5QRkWkMabF6HJmQQm2HBVX"
    assert parse_track_id(f"https://open.spotify.com/playlist/{PID}") is None
    sp.html = TRACK_PAGE
    r = api.get("/api/spotify/track", params={"url": "spotify:track:5QRkWkMabF6HJmQQm2HBVX"}).json()
    assert (r["title"], r["artist"], r["song_id"]) == ("Du hast", "Rammstein, Someone", None)
    with make_wav(tmp_path / "Rammstein - Du hast.wav", seconds=2).open("rb") as f:
        song = api.post("/api/songs", files={"file": ("Rammstein - Du hast.wav", f, "audio/wav")}).json()
    assert api.get("/api/spotify/track", params={"url": "spotify:track:5QRkWkMabF6HJmQQm2HBVX"}).json()["song_id"] == song["id"]
    assert api.get("/api/spotify/track", params={"url": "https://example.com"}).json()["error"]["code"] == "bad_spotify_link"
    sp.html = "<html>changed</html>"
    assert api.get("/api/spotify/track", params={"url": "spotify:track:5QRkWkMabF6HJmQQm2HBVX"}).json()["error"]["code"] == "spotify_page_unreadable"


def test_a_malformed_page_does_not_crash():
    from app.services.spotify_page import parse_embed
    p = parse_embed(embed_page([None, "x", {"uri": "spotify:track:a", "title": "T", "subtitle": "A", "duration": "soon"}]))
    assert p is not None and [(t.title, t.duration) for t in p.tracks] == [("T", 0.0)]
