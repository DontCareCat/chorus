import httpx
import pytest

from app.api.deps import get_youtube_client
from app.main import app
from app.services.youtube import YouTubeClient, clean_title, parse_video_id

VID = "dQw4w9WgXcQ"


@pytest.mark.parametrize("text", [
    f"https://www.youtube.com/watch?v={VID}", f"https://youtube.com/watch?v={VID}&t=42s&list=PL1", f"youtu.be/{VID}?t=3",
    f"https://m.youtube.com/watch?feature=share&v={VID}", f"https://music.youtube.com/watch?v={VID}&si=x", f"https://www.youtube.com/shorts/{VID}",
    f"https://www.youtube.com/embed/{VID}", f"https://www.youtube.com/live/{VID}?feature=share", f"  {VID} ",
])
def test_parse_video_id_accepts_the_usual_links(text):
    assert parse_video_id(text) == VID


@pytest.mark.parametrize("text", ["", "hello", "https://example.com/watch?v=" + VID, "https://www.youtube.com/watch?v=short", "https://www.youtube.com/playlist?list=PL1", "https://youtu.be/"])
def test_parse_video_id_rejects_the_rest(text):
    assert parse_video_id(text) is None


@pytest.mark.parametrize("raw, channel, expected", [
    ("Rammstein - Du Hast (Official Video)", "Rammstein", ("Rammstein", "Du Hast")),
    ("Nena – 99 Luftballons [Lyrics]", "Nena VEVO", ("Nena", "99 Luftballons")),
    ("Song Name (feat. Someone) (Official Audio)", "Artist - Topic", ("Artist", "Song Name (feat. Someone)")),
    ("Just a title", "Some Channel", ("Some Channel", "Just a title")),
    ('Band - "Quoted"', "", ("Band", "Quoted")),
])
def test_clean_title(raw, channel, expected):
    assert clean_title(raw, channel) == expected


class FakeYouTube:
    def __init__(self):
        self.status, self.calls = 200, 0

    def client(self) -> YouTubeClient:
        def handler(request: httpx.Request) -> httpx.Response:
            self.calls += 1
            if self.status != 200:
                return httpx.Response(self.status)
            return httpx.Response(200, json={"title": "Rammstein - Du Hast (Official Video)", "author_name": "Rammstein"})
        return YouTubeClient(httpx.Client(transport=httpx.MockTransport(handler)))


@pytest.fixture
def yt(api):
    fake = FakeYouTube()
    client = fake.client()
    app.dependency_overrides[get_youtube_client] = lambda: client
    return fake


def test_add_youtube_song(api, yt):
    r = api.post("/api/songs/youtube", json={"url": f"https://youtu.be/{VID}?t=5"})
    assert r.status_code == 201
    s = r.json()
    assert (s["artist"], s["title"], s["source"], s["youtube_id"], s["youtube_channel"]) == ("Rammstein", "Du Hast", "youtube", VID, "Rammstein")
    assert s["file_name"] is None and s["available"] is True and s["lyrics_status"] in ("pending", "not_found", "found", "needs_choice")
    again = api.post("/api/songs/youtube", json={"url": f"https://www.youtube.com/watch?v={VID}"})
    assert again.status_code == 200 and again.json()["id"] == s["id"] and yt.calls == 1  # no second lookup
    assert [x["id"] for x in api.get("/api/songs").json()] == [s["id"]]


def test_title_and_artist_can_be_given(api, yt):
    s = api.post("/api/songs/youtube", json={"url": VID, "title": "Mine", "artist": ""}).json()
    assert (s["title"], s["artist"]) == ("Mine", "")


def test_bad_link_and_unavailable_video(api, yt):
    assert api.post("/api/songs/youtube", json={"url": "https://example.com"}).json()["error"]["code"] == "bad_youtube_link"
    yt.status = 404
    r = api.post("/api/songs/youtube", json={"url": VID})
    assert r.status_code == 422 and r.json()["error"]["code"] == "video_unavailable"
    yt.status = 503
    assert api.post("/api/songs/youtube", json={"url": VID}).status_code == 503
    assert api.get("/api/songs").json() == []


def test_youtube_song_has_no_audio_file_and_deletes_cleanly(api, yt):
    s = api.post("/api/songs/youtube", json={"url": VID}).json()
    r = api.get(f"/api/songs/{s['id']}/audio")
    assert r.status_code == 404 and r.json()["error"]["code"] == "no_file"
    assert api.delete(f"/api/songs/{s['id']}").json() == {"result": "deleted"}
    assert api.get("/api/songs").json() == []
    assert api.post("/api/songs/youtube", json={"url": VID}).status_code == 201  # can be added again


def test_scan_leaves_youtube_songs_alone(api, yt):
    s = api.post("/api/songs/youtube", json={"url": VID}).json()
    api.post("/api/library/scan")
    assert api.get("/api/songs").json()[0]["available"] is True and s["available"] is True
