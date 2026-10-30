import httpx
import pytest

from app.api.deps import get_spotify_client
from app.main import app
from app.services.spotify import SpotifyClient, SpotifyTrack, match_tracks, parse_playlist_id

PID = "37i9dQZF1DXcBWIGoYBM5M"


@pytest.mark.parametrize("text", [
    f"https://open.spotify.com/playlist/{PID}", f"https://open.spotify.com/playlist/{PID}?si=abc123", f"open.spotify.com/intl-de/playlist/{PID}",
    f"spotify:playlist:{PID}", f"  https://open.spotify.com/playlist/{PID}  ",
])
def test_parse_playlist_id_accepts_links_and_uris(text):
    assert parse_playlist_id(text) == PID


@pytest.mark.parametrize("text", ["", "hello", f"https://example.com/playlist/{PID}", "https://open.spotify.com/track/" + PID, "https://open.spotify.com/playlist/short"])
def test_parse_playlist_id_rejects_the_rest(text):
    assert parse_playlist_id(text) is None


def T(i, title, artist, dur):
    return SpotifyTrack(spotify_id=f"id{i}", title=title, artist=artist, album="", duration=dur)


def test_match_tracks_by_title_artist_and_length():
    library = [(1, "Rammstein", "Du hast", 234.0), (2, "Nena", "99 Luftballons (Remastered)", 0.0), (3, "Other", "Du hast", 100.0)]
    tracks = [T(1, "Du Hast", "Rammstein", 235.0), T(2, "99 Luftballons", "Nena", 233.0), T(3, "Du hast", "Rammstein", 300.0), T(4, "Sonne", "Rammstein", 270.0),
              T(5, "Du hast - Remastered 2020", "Rammstein, Someone", 234.0)]
    m = match_tracks(tracks, library)
    assert m["id1"] == 1 and m["id2"] == 2 and m["id5"] == 1
    assert "id3" not in m and "id4" not in m  # 66 s apart / not in the library


class FakeSpotify:
    def __init__(self):
        self.token_calls = 0
        self.status = {"playlist": 200, "token": 200}
        self.items = [{"track": {"id": "t1", "name": "Du Hast", "duration_ms": 234000, "artists": [{"name": "Rammstein"}], "album": {"name": "Sehnsucht"}, "is_local": False}},
                      {"track": {"id": None, "name": "Gone"}}, {"track": {"id": "t3", "name": "Local", "is_local": True}}]

    def client(self) -> SpotifyClient:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host == "accounts.spotify.com":
                self.token_calls += 1
                return httpx.Response(self.status["token"], json={"access_token": "tok", "expires_in": 3600})
            assert request.headers["authorization"] == "Bearer tok"
            if self.status["playlist"] != 200:
                return httpx.Response(self.status["playlist"])
            if request.url.path.endswith("/tracks"):
                return httpx.Response(200, json={"total": 3, "items": self.items})
            return httpx.Response(200, json={"name": "Mix"})
        return SpotifyClient(httpx.Client(transport=httpx.MockTransport(handler)))


@pytest.fixture
def sp(api):
    fake = FakeSpotify()
    c = fake.client()
    app.dependency_overrides[get_spotify_client] = lambda: c
    return fake


def set_credentials(api):
    s = api.get("/api/settings").json()
    return api.put("/api/settings", json={**s, "spotify_client_id": "cid", "spotify_client_secret": "secret"})


def test_playlist_needs_credentials_then_lists_tracks_with_matches(api, sp):
    r = api.get("/api/spotify/playlist", params={"url": f"https://open.spotify.com/playlist/{PID}"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "spotify_not_set_up"
    put = set_credentials(api)
    assert put.status_code == 200 and put.json()["spotify_client_secret"] == "********" and put.json()["spotify_client_id"] == "cid"
    api.post("/api/songs/youtube", json={"url": "dQw4w9WgXcQ"})  # a song that is not in the playlist
    from tests.conftest import make_wav  # a library song that is
    r = api.get("/api/spotify/playlist", params={"url": f"spotify:playlist:{PID}"}).json()
    assert r["name"] == "Mix" and r["total"] == 3
    assert [t["title"] for t in r["tracks"]] == ["Du Hast"] and r["tracks"][0]["artist"] == "Rammstein" and r["matched"] == 0
    assert sp.token_calls == 1
    api.get("/api/spotify/playlist", params={"url": f"spotify:playlist:{PID}"})
    assert sp.token_calls == 1  # the token is kept


def test_a_saved_secret_is_kept_when_the_browser_sends_the_mask(api, sp):
    set_credentials(api)
    s = api.get("/api/settings").json()
    assert s["spotify_client_secret"] == "********"
    api.put("/api/settings", json={**s, "default_language": "en"})
    assert api.get("/api/spotify/playlist", params={"url": f"spotify:playlist:{PID}"}).status_code == 200  # still works: the real secret was kept


def test_playlist_errors_are_said_plainly(api, sp):
    set_credentials(api)
    assert api.get("/api/spotify/playlist", params={"url": "https://example.com"}).json()["error"]["code"] == "bad_spotify_link"
    sp.status["playlist"] = 404
    assert api.get("/api/spotify/playlist", params={"url": f"spotify:playlist:{PID}"}).json()["error"]["code"] == "spotify_playlist_unavailable"
    sp.status["playlist"] = 503
    assert api.get("/api/spotify/playlist", params={"url": f"spotify:playlist:{PID}"}).status_code == 503
    sp.status["token"] = 401
    app.dependency_overrides[get_spotify_client] = lambda: sp.client()  # a fresh client has no token kept
    assert api.get("/api/spotify/playlist", params={"url": f"spotify:playlist:{PID}"}).json()["error"]["code"] == "spotify_credentials"
