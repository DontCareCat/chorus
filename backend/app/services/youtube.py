"""YouTube songs: link parsing, title cleaning and the video's public facts (oEmbed, no API key).

Only the video id and the user's own data are kept. The video itself is played by YouTube's own player in the browser.
"""
import re
import threading
from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import httpx

from app.core.errors import AppError

USER_AGENT = "chorus-app/0.1 (private language-learning app)"
OEMBED_URL = "https://www.youtube.com/oembed"
_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"}


def parse_video_id(text: str) -> str | None:
    """The 11-character video id of a watch / shorts / embed / youtu.be link (or a bare id); None if it is not one."""
    text = text.strip()
    if _ID.match(text):
        return text
    if "://" not in text:
        text = "https://" + text
    try:
        u = urlparse(text)
    except ValueError:
        return None
    host = (u.hostname or "").lower()
    parts = [p for p in u.path.split("/") if p]
    cand: str | None = None
    if host in ("youtu.be", "www.youtu.be"):
        cand = parts[0] if parts else None
    elif host in _HOSTS:
        if parts[:1] == ["watch"]:
            cand = (parse_qs(u.query).get("v") or [None])[0]
        elif parts[:1] in (["shorts"], ["embed"], ["live"], ["v"]) and len(parts) > 1:
            cand = parts[1]
    return cand if cand and _ID.match(cand) else None


# "(Official Video)", "[Lyrics]", "(feat. X)" is kept; promotional tags are dropped
_NOISE = re.compile(
    r"[\(\[]\s*(?:official|lyric|lyrics|audio|video|music video|hd|hq|4k|visuali[sz]er|live|remaster(?:ed)?|with lyrics|full song|mv|m/v)[^\)\]]*[\)\]]",
    re.IGNORECASE,
)
_SEPARATORS = (" - ", " – ", " — ", " | ")


def clean_title(raw: str, channel: str = "") -> tuple[str, str]:
    """(artist, title) guessed from a video title and its channel: 'Artist - Song (Official Video)' → ('Artist', 'Song')."""
    title = _NOISE.sub("", raw)
    title = re.sub(r"\s+", " ", title).strip(" -–—|")
    channel = re.sub(r"\s*-\s*Topic$", "", channel.strip(), flags=re.IGNORECASE)
    channel = re.sub(r"VEVO$", "", channel, flags=re.IGNORECASE).strip()
    for sep in _SEPARATORS:
        if sep in title:
            artist, song = (s.strip() for s in title.split(sep, 1))
            if artist and song:
                return artist, song.strip(" \"“”")
    return channel, title.strip(" \"“”")


@dataclass
class VideoInfo:
    video_id: str
    title: str
    channel: str


class YouTubeUnavailable(Exception):
    """YouTube could not be reached."""


class YouTubeClient:
    def __init__(self, http: httpx.Client | None = None):
        self.http = http or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=10)

    def playlist_title(self, list_id: str) -> str:
        """The title of a public playlist (oEmbed), or '' when YouTube does not say: the name is only a suggestion."""
        try:
            r = self.http.get(OEMBED_URL, params={"url": f"https://www.youtube.com/playlist?list={list_id}", "format": "json"})
            return str(r.json().get("title") or "").strip() if r.status_code == 200 else ""
        except (httpx.HTTPError, ValueError):
            return ""

    def length(self, video_id: str) -> float:
        """The video's length in seconds from its public page (no key, nothing played); 0 when it cannot be read: the player supplies it later."""
        try:
            r = self.http.get(f"https://www.youtube.com/watch?v={video_id}", headers={"Accept-Language": "en"}, follow_redirects=True)
            m = re.search(r'"lengthSeconds":"(\d{1,6})"', r.text) if r.status_code == 200 else None
            return float(m.group(1)) if m else 0.0
        except (httpx.HTTPError, ValueError):
            return 0.0

    def info(self, video_id: str) -> VideoInfo:
        try:
            r = self.http.get(OEMBED_URL, params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"})
        except httpx.HTTPError as e:
            raise YouTubeUnavailable(str(e)) from e
        if r.status_code in (401, 403, 404):
            raise AppError("video_unavailable", "This video can't be found or can't be played outside YouTube", 422)
        if r.status_code >= 400:
            raise YouTubeUnavailable(f"YouTube returned HTTP {r.status_code}")
        try:
            j = r.json()
        except ValueError as e:
            raise YouTubeUnavailable("YouTube answered with something unexpected") from e
        return VideoInfo(video_id, str(j.get("title") or ""), str(j.get("author_name") or ""))


REFRESH_AFTER_DAYS = 30


_refreshing = threading.Lock()
MAX_PER_PASS = 40
RETRY_AFTER_FAILURE_DAYS = 1  # offline or YouTube busy: ask again tomorrow
RETRY_UNPLAYABLE_DAYS = 7  # gone, private or not embeddable: look again in a week


def refresh_stale(factory, client: "YouTubeClient", now=None) -> int:
    """YouTube's own facts about a song are checked again after 30 days: the channel and whether it can still be played;
    the length is read again from the public page (kept when that fails).

    What the user confirmed (title, artist, timing) stays. One pass at a time, a few songs per pass, saved song by song.
    """
    from sqlalchemy import select

    from app.db.models import Song, SongSource
    from app.db.models.types import utcnow

    if not _refreshing.acquire(blocking=False):
        return 0
    try:
        now = now or utcnow()
        done = 0
        with factory() as session:
            ids = session.scalars(
                select(Song.id).where(Song.source == SongSource.youtube, Song.removed.is_(False), _stale(now)).order_by(Song.youtube_checked_at).limit(MAX_PER_PASS)
            ).all()
            for song_id in ids:
                song = session.get(Song, song_id)
                try:
                    info = client.info(song.youtube_id)
                    song.youtube_channel, song.available = info.channel or None, True
                    song.duration = client.length(song.youtube_id) or song.duration
                    song.youtube_checked_at = now
                except AppError:
                    song.youtube_channel, song.available = None, False  # removed, private or not embeddable
                    song.youtube_checked_at = now - timedelta(days=REFRESH_AFTER_DAYS - RETRY_UNPLAYABLE_DAYS)
                except YouTubeUnavailable:
                    song.youtube_checked_at = now - timedelta(days=REFRESH_AFTER_DAYS - RETRY_AFTER_FAILURE_DAYS)
                    session.commit()
                    break  # offline or busy: the rest waits for tomorrow too
                session.commit()
                done += 1
        return done
    finally:
        _refreshing.release()


_filling = threading.Lock()
_LENGTH_PER_PASS = 10
_tried: dict[int, tuple[float, int]] = {}  # song id -> (not before, failures): a video that gives no length is asked again later, and not forever


def _due(song_id: int, now: float) -> bool:
    not_before, failures = _tried.get(song_id, (0.0, 0))
    return failures < 6 and now >= not_before


def _failed(song_id: int, now: float) -> None:
    failures = _tried.get(song_id, (0.0, 0))[1] + 1
    _tried[song_id] = (now + min(86400, 600 * 2 ** failures), failures)


def fill_lengths(factory, client: "YouTubeClient", on_learned=None) -> int:
    """Gives YouTube songs without a length their real one (read from the video's page). A few per pass, saved song by song; a video that
    gives none (private, live, offline) is asked again after a growing pause and given up on after a few tries."""
    import time

    from sqlalchemy import select

    from app.db.models import Song, SongSource

    if not _filling.acquire(blocking=False):
        return 0
    try:
        done, learned = 0, []
        with factory() as session:
            ids = session.scalars(select(Song.id).where(Song.source == SongSource.youtube, Song.removed.is_(False), Song.duration <= 0)).all()
            for song_id in [i for i in ids if _due(i, time.time())][:_LENGTH_PER_PASS]:
                song = session.get(Song, song_id)
                if song is None or song.removed or song.duration > 0 or not song.youtube_id:
                    continue  # gone or learned meanwhile
                length = client.length(song.youtube_id)
                session.refresh(song)  # the player may have told the length while the page loaded
                if length > 0 and song.duration <= 0:
                    song.duration = length
                    session.commit()
                    done += 1
                    if song.lyrics_status != "found":
                        learned.append(song_id)
                elif length <= 0:
                    _failed(song_id, time.time())
        if learned and on_learned:
            on_learned(learned)  # the length makes the lyrics match better
        return done
    finally:
        _filling.release()


def has_unknown_length(session) -> bool:
    from sqlalchemy import select

    from app.db.models import Song, SongSource

    return session.scalar(select(Song.id).where(Song.source == SongSource.youtube, Song.removed.is_(False), Song.duration <= 0).limit(1)) is not None


def _stale(now):
    from app.db.models import Song

    return (Song.youtube_checked_at.is_(None)) | (Song.youtube_checked_at < now - timedelta(days=REFRESH_AFTER_DAYS))


def has_stale(session, now=None) -> bool:
    from sqlalchemy import select

    from app.db.models import Song, SongSource
    from app.db.models.types import utcnow

    now = now or utcnow()
    return session.scalar(select(Song.id).where(Song.source == SongSource.youtube, Song.removed.is_(False), _stale(now)).limit(1)) is not None


def add_youtube_video(session, cfg, youtube: "YouTubeClient", video_id: str, title: str | None = None, artist: str | None = None, with_length: bool = True):
    """The song for a video: the one already in the library (a removed one comes back, with the title and artist given), or a new one made
    from what YouTube shows publicly. Returns (song, created). The length is read from the video's page unless with_length is off (a playlist import: the player supplies it later). Raises AppError (video gone / not embeddable) or YouTubeUnavailable."""
    from sqlalchemy import select
    from sqlalchemy.exc import IntegrityError

    from app.db.models import LyricsStatus, Song, SongSource
    from app.db.models.types import utcnow

    existing = session.scalar(select(Song).where(Song.youtube_id == video_id))
    if existing is not None:
        if existing.removed:
            existing.removed = False
            if title:
                existing.title = title.strip()
            if artist is not None:
                existing.artist = artist.strip()
            session.commit()
        return existing, False
    info = youtube.info(video_id)  # raises AppError (gone / not embeddable) or YouTubeUnavailable
    clean_artist, clean_song = clean_title(info.title, info.channel)
    song = Song(
        title=(title or clean_song or video_id).strip(), artist=(artist if artist is not None else clean_artist).strip(), duration=youtube.length(video_id) if with_length else 0.0,
        language=cfg.default_language, source=SongSource.youtube, youtube_id=video_id, youtube_channel=info.channel or None,
        youtube_checked_at=utcnow(), content_hash=f"youtube:{video_id}", available=True, has_cover=False, cover_source="youtube",
        lyrics_status=LyricsStatus.pending,
    )
    session.add(song)
    try:
        session.commit()
    except IntegrityError:  # the same video was added at the same moment
        session.rollback()
        existing = session.scalar(select(Song).where(Song.youtube_id == video_id))
        if existing is None:
            raise
        return existing, False
    return song, True
