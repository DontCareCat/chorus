import time
from dataclasses import dataclass
from typing import Any, Callable

import httpx

from app.core.config import settings

USER_AGENT = "chorus-app/0.1 (private language-learning app)"


class LrclibUnavailable(Exception):
    """LRCLIB could not be reached or kept failing after retries."""


@dataclass
class LyricsCandidate:
    id: int
    artist: str
    title: str
    album: str | None
    duration: float
    synced_lyrics: str | None
    plain_lyrics: str | None
    instrumental: bool

    @classmethod
    def from_json(cls, j: dict[str, Any]) -> "LyricsCandidate":
        return cls(
            id=int(j["id"]), artist=j.get("artistName") or "", title=j.get("trackName") or j.get("name") or "",
            album=j.get("albumName"), duration=float(j.get("duration") or 0),
            synced_lyrics=j.get("syncedLyrics") or None, plain_lyrics=j.get("plainLyrics") or None,
            instrumental=bool(j.get("instrumental")),
        )

    @property
    def is_synced(self) -> bool:
        return bool(self.synced_lyrics)


class LrclibClient:
    """Raw LRCLIB access: returns JSON; retries 5xx/429/timeouts with backoff."""

    def __init__(
        self, http: httpx.Client | None = None, retries: int = 3, backoff: float = 0.5,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.http = http or httpx.Client(
            base_url=settings.lrclib_base_url, headers={"User-Agent": USER_AGENT}, timeout=15,
        )
        self.retries, self.backoff, self.sleep = retries, backoff, sleep

    def _request(self, path: str, params: dict[str, Any]) -> httpx.Response:
        last: Exception | None = None
        for attempt in range(self.retries):
            try:
                r = self.http.get(path, params=params)
                if r.status_code < 500 and r.status_code != 429:
                    return r
                last = LrclibUnavailable(f"LRCLIB returned HTTP {r.status_code}")
            except httpx.TransportError as e:
                last = e
            if attempt + 1 < self.retries:
                self.sleep(self.backoff * 2**attempt)
        raise LrclibUnavailable(str(last))

    def get(self, artist: str, title: str, album: str | None, duration: float) -> dict | None:
        params: dict[str, Any] = {"artist_name": artist, "track_name": title, "duration": round(duration)}
        if album:
            params["album_name"] = album
        r = self._request("/get", params)
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise LrclibUnavailable(f"LRCLIB returned HTTP {r.status_code}")
        return r.json()

    def get_by_id(self, lrclib_id: int) -> dict | None:
        r = self._request(f"/get/{lrclib_id}", {})
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise LrclibUnavailable(f"LRCLIB returned HTTP {r.status_code}")
        return r.json()

    def search(self, query: str) -> list[dict]:
        r = self._request("/search", {"q": query})
        if r.status_code != 200:
            raise LrclibUnavailable(f"LRCLIB returned HTTP {r.status_code}")
        return r.json()
