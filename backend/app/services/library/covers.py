"""Album covers found online (MusicBrainz + Cover Art Archive), kept in a folder of our own.

Songs without embedded art get a lookup after they are added. A **confident** match is saved by itself; when the match is
not clear the person chooses from candidates. Images are stored as files in the covers folder (never next to the music) and
referenced from the database (`songs.cover_source`, `songs.cover_file`).
"""
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import httpx
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.db.models import Song
from app.services.game.matching import normalize
from app.services.library.tags import MAX_COVER_BYTES, _sniff

log = logging.getLogger(__name__)
USER_AGENT = "chorus-app/0.2 (private language-learning app; https://github.com/DontCareCat/chorus)"
EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}
CONFIDENT_SCORE = 95  # MusicBrainz' own 0-100 match score
MAX_CANDIDATES = 8


class CoverUnavailable(Exception):
    """MusicBrainz or the Cover Art Archive could not be reached or kept failing."""


@dataclass
class CoverCandidate:
    mbid: str
    title: str  # release (album) title
    artist: str
    date: str | None
    score: int


def covers_dir() -> Path:
    return Path(settings.covers_dir) if settings.covers_dir else Path(settings.media_dir).resolve().parent / "covers"


class CoverClient:
    """Raw access with the courtesy MusicBrainz asks for: a User-Agent, at most one request a second, retries."""

    def __init__(
        self, mb: httpx.Client | None = None, caa: httpx.Client | None = None, retries: int = 3, backoff: float = 0.5,
        sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic, min_gap: float = 1.1,
    ):
        headers = {"User-Agent": USER_AGENT}
        self.mb = mb or httpx.Client(base_url=settings.musicbrainz_base_url, headers=headers, timeout=15)
        self.caa = caa or httpx.Client(base_url=settings.coverart_base_url, headers=headers, timeout=20, follow_redirects=True)
        self.retries, self.backoff, self.sleep, self.clock, self.min_gap = retries, backoff, sleep, clock, min_gap
        self._last_mb = float("-inf")

    def _get(self, http: httpx.Client, path: str, params: dict[str, Any] | None = None, pace: bool = False) -> httpx.Response:
        last: Exception | None = None
        for attempt in range(self.retries):
            if pace:
                wait = self.min_gap - (self.clock() - self._last_mb)
                if wait > 0:
                    self.sleep(wait)
                self._last_mb = self.clock()
            try:
                r = http.get(path, params=params)
                if r.status_code < 500 and r.status_code not in (429, 503):
                    return r
                last = CoverUnavailable(f"HTTP {r.status_code}")
            except httpx.TransportError as e:
                last = e
            if attempt + 1 < self.retries:
                self.sleep(self.backoff * 2**attempt)
        raise CoverUnavailable(str(last))

    def search(self, artist: str, album: str | None, title: str) -> list[CoverCandidate]:
        """Releases that match: by album when the song has one, else by the releases of recordings with that title."""
        a = artist.replace('"', " ").strip()
        out: list[CoverCandidate] = []
        if album:
            query = f'release:"{album.replace(chr(34), " ")}"' + (f' AND artist:"{a}"' if a else "")
            r = self._get(self.mb, "/release", {"query": query, "fmt": "json", "limit": 25}, pace=True)
            if r.status_code != 200:
                raise CoverUnavailable(f"MusicBrainz returned HTTP {r.status_code}")
            for rel in r.json().get("releases", []):
                out.append(_candidate(rel, rel))
        else:
            query = f'recording:"{title.replace(chr(34), " ")}"' + (f' AND artist:"{a}"' if a else "")
            r = self._get(self.mb, "/recording", {"query": query, "fmt": "json", "limit": 10}, pace=True)
            if r.status_code != 200:
                raise CoverUnavailable(f"MusicBrainz returned HTTP {r.status_code}")
            for rec in r.json().get("recordings", []):
                for rel in rec.get("releases", []):
                    out.append(_candidate(rel, rec))
        return out

    def front(self, mbid: str, size: int = 500) -> tuple[bytes, str] | None:
        """The release's front cover, validated by its bytes; None when there is none."""
        r = self._get(self.caa, f"/release/{mbid}/front-{size}")
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise CoverUnavailable(f"Cover Art Archive returned HTTP {r.status_code}")
        return validate_image(r.content)


def _candidate(rel: dict, scored: dict) -> CoverCandidate:
    credit = rel.get("artist-credit") or scored.get("artist-credit") or []
    artist = "".join(c.get("name", "") + c.get("joinphrase", "") for c in credit if isinstance(c, dict))
    return CoverCandidate(
        mbid=rel["id"], title=rel.get("title", ""), artist=artist, date=rel.get("date"), score=int(scored.get("score", 0)),
    )


def validate_image(data: bytes) -> tuple[bytes, str] | None:
    """(bytes, mime) when this really is an image of a type we serve and not absurdly large."""
    if not data or len(data) > MAX_COVER_BYTES:
        return None
    mime = _sniff(data)
    return (data, mime) if mime else None


def confident_match(song: Song, candidates: list[CoverCandidate]) -> list[CoverCandidate]:
    """The candidates to try when ONE album is clearly the right one (reissues of it count as the same album), else []."""
    if not candidates or not song.artist:
        return []
    top = max(c.score for c in candidates)
    if top < CONFIDENT_SCORE:
        return []
    same_artist = [c for c in candidates if c.score >= top - 5 and normalize(c.artist) and (
        normalize(c.artist) == normalize(song.artist) or normalize(song.artist) in normalize(c.artist))]
    titles = {normalize(c.title) for c in same_artist}
    if not same_artist or len(titles) != 1:
        return []
    if song.album and normalize(song.album) not in titles:
        return []
    return same_artist[:3]


def store_cover(session: Session, song: Song, data: bytes, mime: str, source: str) -> None:
    folder = covers_dir()
    folder.mkdir(parents=True, exist_ok=True)
    old = folder / song.cover_file if song.cover_file else None
    name = f"{song.id}{EXTENSIONS[mime]}"
    (folder / name).write_bytes(data)
    if old is not None and old.name != name:
        old.unlink(missing_ok=True)
    song.cover_file, song.cover_source, song.has_cover = name, source, True
    session.commit()


def remove_cover(session: Session, song: Song) -> None:
    if song.cover_file:
        (covers_dir() / song.cover_file).unlink(missing_ok=True)
    song.cover_file, song.cover_source = None, None
    session.commit()


def stored_cover(song: Song) -> tuple[bytes, str] | None:
    if not song.cover_file:
        return None
    path = covers_dir() / song.cover_file
    try:
        return validate_image(path.read_bytes())
    except OSError:
        return None


def find_cover(session: Session, song: Song, client: CoverClient) -> str:
    """Automatic lookup. Returns the song's new cover_source: 'online' (saved), 'choose' (candidates exist, a person
    has to pick), or 'none' (nothing found; remembered so it is not asked again by itself)."""
    if song.cover_source in ("embedded", "online", "custom"):
        return song.cover_source
    candidates = client.search(song.artist, song.album, song.title)
    for c in confident_match(song, candidates):
        found = client.front(c.mbid)
        if found:
            store_cover(session, song, found[0], found[1], "online")
            return "online"
    song.cover_source = "choose" if candidates else "none"
    session.commit()
    return song.cover_source


def fetch_covers_for_songs(factory: sessionmaker, client: CoverClient, song_ids: list[int]) -> None:
    """Background task for newly added songs without embedded art (own DB session, never raises)."""
    from app.services.settings import load_settings

    for song_id in song_ids:
        with factory() as session:
            if not load_settings(session).auto_fetch_covers:
                return
            song = session.get(Song, song_id)
            if song is None or song.has_cover:
                continue
            try:
                find_cover(session, song, client)
            except Exception:
                log.exception("cover lookup failed for song %s", song_id)
