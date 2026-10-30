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


def test_cover_routes_work_without_a_file(api, yt):
    s = api.post("/api/songs/youtube", json={"url": VID}).json()
    assert api.get(f"/api/songs/{s['id']}/cover").status_code == 404
    assert api.delete(f"/api/songs/{s['id']}/cover").status_code == 200


def test_unknown_length_does_not_break_lyrics(api, yt, lrclib):
    from app.services.lyrics.normalizer import normalize
    from app.services.lyrics.lrc import parse_lyrics_text
    n = normalize(parse_lyrics_text("[00:01.00] a\n[00:05.00] b"), 0.0)
    assert len(n.lines) == 2 and not n.warnings


def test_a_second_add_of_the_same_video_after_a_race_returns_the_song(api, yt, session):
    first = api.post("/api/songs/youtube", json={"url": VID}).json()
    from app.db.models import Song
    from sqlalchemy import select
    assert len(list(session.scalars(select(Song)))) == 1
    assert api.post("/api/songs/youtube", json={"url": f"youtu.be/{VID}"}).json()["id"] == first["id"]


def test_length_is_learned_once_and_lyrics_are_looked_up_again(api, yt, lrclib):
    s = api.post("/api/songs/youtube", json={"url": VID}).json()
    lrclib.get_result = None
    r = api.patch(f"/api/songs/{s['id']}", json={"duration": 213.4})
    assert r.status_code == 200 and r.json()["duration"] == 213.4
    again = api.patch(f"/api/songs/{s['id']}", json={"duration": 214})  # the player tells it on every play: kept up to date
    assert again.json()["duration"] == 214
    assert any("/get" in c or "/search" in c for c in lrclib.calls)


def test_a_file_songs_length_cannot_be_changed(api, tmp_path):
    from tests.conftest import make_wav
    with make_wav(tmp_path / "A - B.wav", seconds=2).open("rb") as f:
        s = api.post("/api/songs", files={"file": ("A - B.wav", f, "audio/wav")}).json()
    assert api.patch(f"/api/songs/{s['id']}", json={"duration": 500}).json()["duration"] == s["duration"]


def test_looking_again_never_leaves_a_song_pending_or_replaces_lyrics(api, yt, lrclib, tmp_path):
    s = api.post("/api/songs/youtube", json={"url": VID}).json()
    lrc = tmp_path / "x.lrc"
    lrc.write_text("[00:01.00] eins\n[00:05.00] zwei\n")
    with lrc.open("rb") as f:
        api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("x.lrc", f, "text/plain")})
    api.patch(f"/api/songs/{s['id']}", json={"duration": 200})
    after = [x for x in api.get("/api/songs").json() if x["id"] == s["id"]][0]
    assert after["lyrics_status"] != "pending"
    assert api.get(f"/api/songs/{s['id']}/lyrics").json()["source"] == "upload"


def test_switching_youtube_off_stops_adding_and_playing(api, yt, tmp_path):
    s = api.post("/api/songs/youtube", json={"url": VID}).json()
    lrc = tmp_path / "x.lrc"
    lrc.write_text("[00:01.00] eins zwei drei vier\n[00:05.00] fuenf sechs sieben acht\n[00:09.00] neun zehn elf zwoelf\n")
    with lrc.open("rb") as f:
        api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("x.lrc", f, "text/plain")})
    game = api.post("/api/games", json={"song_id": s["id"]})
    assert game.status_code == 201 and game.json()["youtube_id"] == VID
    settings = api.get("/api/settings").json()
    api.put("/api/settings", json={**settings, "youtube_enabled": False})
    assert api.post("/api/songs/youtube", json={"url": "dQw4w9WgXcQ"}).json()["error"]["code"] == "youtube_disabled"
    assert api.get(f"/api/games/{game.json()['public_id']}").status_code == 403  # not finished: not played while off
    before = len(api.get("/api/games").json())
    assert api.post("/api/games", json={"song_id": s["id"]}).status_code == 403
    assert len(api.get("/api/games").json()) == before  # no stray game
    assert [x["available"] for x in api.get("/api/songs").json()] == [False]
    api.put("/api/settings", json={**settings, "youtube_enabled": True})
    assert [x["available"] for x in api.get("/api/songs").json()] == [True]


def test_stale_youtube_facts_are_checked_again_after_30_days(api, yt, session):
    from datetime import timedelta
    from sqlalchemy.orm import sessionmaker
    from app.db.models import Song
    from app.db.models.types import utcnow
    from app.services.youtube import refresh_stale
    s = api.post("/api/songs/youtube", json={"url": VID}).json()
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    with factory() as q:
        q.get(Song, s["id"]).youtube_checked_at = utcnow() - timedelta(days=31)
        q.commit()
    assert refresh_stale(factory, yt.client()) == 1 and refresh_stale(factory, yt.client()) == 0
    yt.status = 404
    with factory() as q:
        q.get(Song, s["id"]).youtube_checked_at = utcnow() - timedelta(days=31)
        q.commit()
    assert refresh_stale(factory, yt.client()) == 1
    with factory() as q:
        gone = q.get(Song, s["id"])
        assert gone.available is False and gone.youtube_channel is None


def test_refresh_backs_off_when_youtube_is_unreachable_and_runs_one_at_a_time(api, yt, session):
    from datetime import timedelta
    from sqlalchemy.orm import sessionmaker
    from app.db.models import Song
    from app.db.models.types import utcnow
    from app.services.youtube import _refreshing, refresh_stale
    ids = [api.post("/api/songs/youtube", json={"url": v}).json()["id"] for v in (VID, "9bZkp7q19f0")]
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    with factory() as q:
        for i in ids:
            q.get(Song, i).youtube_checked_at = utcnow() - timedelta(days=40)
        q.commit()
    yt.status = 503
    calls = yt.calls
    assert refresh_stale(factory, yt.client()) == 0 and yt.calls == calls + 1  # stops at the first failure
    yt.status = 200
    assert refresh_stale(factory, yt.client()) == 1  # the other song is still due (the failed one waits a day)
    with factory() as q:
        songs = [q.get(Song, i) for i in ids]
        assert all(s.available for s in songs)
    assert _refreshing.acquire(blocking=False)
    try:
        assert refresh_stale(factory, yt.client()) == 0  # one pass at a time
    finally:
        _refreshing.release()


def test_refresh_updates_the_channel_and_drops_the_length(api, yt, session):
    from datetime import timedelta
    from sqlalchemy.orm import sessionmaker
    from app.db.models import Song
    from app.db.models.types import utcnow
    from app.services.youtube import refresh_stale
    s = api.post("/api/songs/youtube", json={"url": VID}).json()
    api.patch(f"/api/songs/{s['id']}", json={"duration": 213})
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    with factory() as q:
        song = q.get(Song, s["id"])
        song.youtube_checked_at, song.youtube_channel = utcnow() - timedelta(days=40), "old"
        q.commit()
    assert refresh_stale(factory, yt.client()) == 1
    with factory() as q:
        song = q.get(Song, s["id"])
        assert song.youtube_channel == "Rammstein" and song.duration == 0


def test_preview_cleans_title_and_artist_and_saves_nothing(api, yt):
    r = api.get("/api/songs/youtube/preview", params={"url": f"https://youtu.be/{VID}"})
    assert r.status_code == 200
    assert r.json() == {"video_id": VID, "title": "Du Hast", "artist": "Rammstein", "channel": "Rammstein", "existing_id": None, "existing_title": None}
    assert api.get("/api/songs").json() == []


def test_preview_reports_a_song_already_in_the_library(api, yt):
    s = api.post("/api/songs/youtube", json={"url": VID, "title": "Mine"}).json()
    calls = yt.calls
    r = api.get("/api/songs/youtube/preview", params={"url": VID}).json()
    assert r["existing_id"] == s["id"] and r["existing_title"] == "Mine" and yt.calls == calls  # no lookup needed
    api.delete(f"/api/songs/{s['id']}")
    assert api.get("/api/songs/youtube/preview", params={"url": VID}).json()["existing_id"] is None


def test_preview_rejects_a_bad_link_and_a_switched_off_setting(api, yt):
    r = api.get("/api/songs/youtube/preview", params={"url": "https://example.com"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "bad_youtube_link"
    settings = api.get("/api/settings").json()
    api.put("/api/settings", json={**settings, "youtube_enabled": False})
    r = api.get("/api/songs/youtube/preview", params={"url": VID})
    assert r.status_code == 403 and r.json()["error"]["code"] == "youtube_disabled"


def test_preview_passes_youtube_errors_through_like_add(api, yt):
    yt.status = 404
    r = api.get("/api/songs/youtube/preview", params={"url": VID})
    assert r.status_code == 422 and r.json()["error"]["code"] == "video_unavailable"
    yt.status = 503
    assert api.get("/api/songs/youtube/preview", params={"url": VID}).status_code == 503
    assert api.get("/api/songs").json() == []


def test_import_several_videos_at_once(api, yt):
    r = api.post("/api/songs/youtube/import", json={"video_ids": [VID, "9bZkp7q19f0", VID, "bad"]}).json()
    assert (r["added"], r["existing"]) == (2, 0)
    assert [s["youtube_id"] for s in r["songs"]] == [VID, "9bZkp7q19f0"]
    assert r["failed"] == [{"video_id": "bad", "reason": "not_a_video"}]
    again = api.post("/api/songs/youtube/import", json={"video_ids": [VID]}).json()
    assert (again["added"], again["existing"]) == (0, 1)
    assert len(api.get("/api/songs").json()) == 2


def test_import_skips_a_gone_video_and_stops_when_youtube_is_unreachable(api, yt):
    yt.status = 404
    r = api.post("/api/songs/youtube/import", json={"video_ids": [VID]}).json()
    assert r["failed"] == [{"video_id": VID, "reason": "video_unavailable"}] and r["added"] == 0
    yt.status = 503
    r = api.post("/api/songs/youtube/import", json={"video_ids": [VID, "9bZkp7q19f0"]}).json()
    assert r["not_tried"] == [VID, "9bZkp7q19f0"] and r["added"] == 0
    assert api.get("/api/songs").json() == []


def test_import_is_switched_off_with_youtube_songs(api, yt):
    settings = api.get("/api/settings").json()
    api.put("/api/settings", json={**settings, "youtube_enabled": False})
    assert api.post("/api/songs/youtube/import", json={"video_ids": [VID]}).json()["error"]["code"] == "youtube_disabled"
    assert api.post("/api/songs/youtube/import", json={"video_ids": []}).status_code == 422


def test_import_can_leave_the_lyrics_lookup_to_the_caller(api, yt, lrclib):
    api.post("/api/songs/youtube/import", json={"video_ids": [VID], "lookup": False})
    assert not any("/search" in c or "/get" in c for c in lrclib.calls)
    api.post("/api/songs/youtube/import", json={"video_ids": ["9bZkp7q19f0"]})
    assert any("/search" in c or "/get" in c for c in lrclib.calls)


def test_import_gives_up_after_its_time_and_reports_the_rest(api, yt, monkeypatch):
    import app.api.routes.songs as songs_route
    monkeypatch.setattr(songs_route, "IMPORT_SECONDS", -1)
    r = api.post("/api/songs/youtube/import", json={"video_ids": [VID, "9bZkp7q19f0"]}).json()
    assert r["not_tried"] == [VID, "9bZkp7q19f0"] and r["added"] == 0


def test_playlist_title_comes_from_oembed_or_is_empty(api, yt):
    assert api.get("/api/songs/youtube/playlist-title", params={"list": "PLAw_8IRmyA1I"}).json() == {"title": "Rammstein - Du Hast (Official Video)"}  # the fake answers like a video
    yt.status = 404
    assert api.get("/api/songs/youtube/playlist-title", params={"list": "PLAw_8IRmyA1I"}).json() == {"title": ""}
    assert api.get("/api/songs/youtube/playlist-title", params={"list": "bad id"}).status_code == 422
