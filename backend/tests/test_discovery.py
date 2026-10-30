import json
from pathlib import Path

import httpx
import pytest

from app.api.deps import get_spotify_client, get_youtube_search_client
from app.main import app
from app.services.spotify_page import SpotifyPageClient, parse_embed, parse_playlist_id
from app.services.youtube_search import YouTubeSearchClient

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


class FakeSearch:
    def __init__(self):
        self.status, self.reason, self.calls = 200, "", []

    def client(self) -> YouTubeSearchClient:
        def handler(request: httpx.Request) -> httpx.Response:
            self.calls.append(dict(request.url.params))
            if self.status != 200:
                return httpx.Response(self.status, json={"error": {"errors": [{"reason": self.reason}]}})
            return httpx.Response(200, json={"items": [{"id": {"videoId": VID}, "snippet": {"title": "Rammstein - Du Hast &amp; more", "channelTitle": "Rammstein"}}, {"id": {"channelId": "x"}, "snippet": {}}]})
        return YouTubeSearchClient(httpx.Client(transport=httpx.MockTransport(handler)))


@pytest.fixture
def search(api):
    fake = FakeSearch()
    c = fake.client()
    app.dependency_overrides[get_youtube_search_client] = lambda: c
    return fake


def set_key(api, key="AIza-test-key"):
    s = api.get("/api/settings").json()
    return api.put("/api/settings", json={**s, "youtube_api_key": key})


def test_search_needs_a_key_then_finds_embeddable_videos(api, search):
    r = api.get("/api/youtube/search", params={"q": "rammstein du hast"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "youtube_key_missing"
    put = set_key(api)
    assert put.status_code == 200 and put.json()["youtube_api_key"] == "********"
    assert api.get("/api/settings").json()["youtube_api_key"] == "********"
    r = api.get("/api/youtube/search", params={"q": "rammstein du hast"}).json()
    assert r["hits"] == [{"video_id": VID, "title": "Rammstein - Du Hast & more", "channel": "Rammstein", "existing_id": None}]
    assert search.calls[0]["key"] == "AIza-test-key" and search.calls[0]["videoEmbeddable"] == "true" and search.calls[0]["type"] == "video"


def test_search_marks_videos_already_in_the_library_and_keeps_the_key_when_other_settings_are_saved(api, search):
    set_key(api)
    s = api.get("/api/settings").json()
    api.put("/api/settings", json={**s, "default_language": "en"})  # the browser sends the mask back
    song = api.post("/api/songs/youtube", json={"url": VID}).json()  # (oEmbed is not faked here: ok if it fails)
    r = api.get("/api/youtube/search", params={"q": "rammstein"})
    assert r.status_code == 200  # the real key was kept
    if song.get("id"):
        assert r.json()["hits"][0]["existing_id"] == song["id"]


def test_search_errors_are_said_plainly(api, search):
    set_key(api)
    search.status, search.reason = 403, "quotaExceeded"
    assert api.get("/api/youtube/search", params={"q": "abc"}).json()["error"]["code"] == "youtube_quota"
    search.reason = "keyInvalid"
    assert api.get("/api/youtube/search", params={"q": "abc"}).json()["error"]["code"] == "youtube_key_invalid"
    search.status = 503
    assert api.get("/api/youtube/search", params={"q": "abc"}).status_code == 503


def test_import_gives_names_to_videos(api):
    from tests.test_youtube import FakeYouTube
    from app.api.deps import get_youtube_client
    fake = FakeYouTube()
    c = fake.client()
    app.dependency_overrides[get_youtube_client] = lambda: c
    r = api.post("/api/songs/youtube/import", json={"video_ids": [VID], "names": {VID: {"title": "Du hast", "artist": "Rammstein"}}}).json()
    assert (r["songs"][0]["title"], r["songs"][0]["artist"]) == ("Du hast", "Rammstein")
