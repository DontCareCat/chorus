"""Public Spotify playlists, through Spotify's Web API with the person's own app credentials (Client Credentials flow, no login).

Only titles, artists and lengths are read: Spotify gives no audio here, and nothing from it is stored. A track becomes a song only by
matching a song already in the library (same artist and title, about the same length); the rest is listed so it can be found on YouTube.
"""
import re
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from app.core.errors import AppError
from app.services.game.matching import normalize

TOKEN_URL = "https://accounts.spotify.com/api/token"
API_URL = "https://api.spotify.com/v1"
USER_AGENT = "chorus-app/0.1 (private language-learning app)"
MAX_TRACKS = 1000
_ID = re.compile(r"^[A-Za-z0-9]{22}$")


def parse_playlist_id(text: str) -> str | None:
    """The 22-character id of an open.spotify.com/playlist/… link or a spotify:playlist:… uri."""
    text = text.strip()
    m = re.fullmatch(r"spotify:playlist:([A-Za-z0-9]{22})", text)
    if m:
        return m.group(1)
    if "://" not in text:
        text = "https://" + text
    try:
        u = urlparse(text)
    except ValueError:
        return None
    if (u.hostname or "").lower() not in ("open.spotify.com", "play.spotify.com"):
        return None
    parts = [p for p in u.path.split("/") if p]
    if parts[:1] and parts[0].startswith("intl-") and len(parts) > 1:
        parts = parts[1:]  # open.spotify.com/intl-de/playlist/…
    if len(parts) >= 2 and parts[0] == "playlist" and _ID.match(parts[1]):
        return parts[1]
    return None


@dataclass
class SpotifyTrack:
    spotify_id: str
    title: str
    artist: str
    album: str
    duration: float


@dataclass
class SpotifyPlaylist:
    name: str
    tracks: list[SpotifyTrack]
    total: int


class SpotifyUnavailable(Exception):
    """Spotify could not be reached or is busy."""


class SpotifyClient:
    def __init__(self, http: httpx.Client | None = None, now=time.monotonic):
        self.http = http or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=10)
        self.now = now
        self._token: tuple[str, str, float] | None = None  # (client id, token, expires at)

    def _get_token(self, client_id: str, secret: str) -> str:
        if self._token and self._token[0] == client_id and self._token[2] > self.now() + 30:
            return self._token[1]
        try:
            r = self.http.post(TOKEN_URL, data={"grant_type": "client_credentials"}, auth=(client_id, secret))
        except httpx.HTTPError as e:
            raise SpotifyUnavailable(str(e)) from e
        if r.status_code in (400, 401):
            raise AppError("spotify_credentials", "Spotify did not accept the client id and secret. Check them in Settings.", 422)
        if r.status_code >= 400:
            raise SpotifyUnavailable(f"Spotify returned HTTP {r.status_code}")
        j = r.json()
        self._token = (client_id, str(j["access_token"]), self.now() + float(j.get("expires_in", 3600)))
        return self._token[1]

    def playlist(self, playlist_id: str, client_id: str, secret: str) -> SpotifyPlaylist:
        if not client_id or not secret:
            raise AppError("spotify_not_set_up", "Add your Spotify client id and secret in Settings first.", 422)
        headers = {"Authorization": f"Bearer {self._get_token(client_id, secret)}"}

        def get(url: str, params: dict | None = None) -> dict:
            try:
                r = self.http.get(url, params=params, headers=headers)
            except httpx.HTTPError as e:
                raise SpotifyUnavailable(str(e)) from e
            if r.status_code in (403, 404):
                raise AppError("spotify_playlist_unavailable", "That playlist is private or does not exist. Only public playlists can be read.", 422)
            if r.status_code == 429:
                raise SpotifyUnavailable("Spotify asks to wait a moment")
            if r.status_code >= 400:
                raise SpotifyUnavailable(f"Spotify returned HTTP {r.status_code}")
            return r.json()

        head = get(f"{API_URL}/playlists/{playlist_id}", {"fields": "name"})
        tracks: list[SpotifyTrack] = []
        total = 0
        offset = 0
        while offset < MAX_TRACKS:
            page = get(
                f"{API_URL}/playlists/{playlist_id}/tracks",
                {"limit": 100, "offset": offset, "fields": "total,items(track(id,name,duration_ms,artists(name),album(name),is_local))"},
            )
            total = int(page.get("total") or 0)
            for item in page.get("items") or []:
                t = item.get("track") or {}
                if not t.get("id") or t.get("is_local"):
                    continue
                tracks.append(SpotifyTrack(
                    spotify_id=t["id"], title=t.get("name") or "", artist=", ".join(a.get("name", "") for a in t.get("artists") or []),
                    album=(t.get("album") or {}).get("name") or "", duration=(t.get("duration_ms") or 0) / 1000,
                ))
            offset += 100
            if offset >= total:
                break
        return SpotifyPlaylist(name=str(head.get("name") or ""), tracks=tracks, total=total)


def _key(text: str) -> str:
    """A title or artist for comparing: lower case, accents and punctuation gone, '(feat. …)', '- Remastered' and '(Live)' dropped."""
    text = re.sub(r"\s*[\(\[][^\)\]]*(feat|ft\.|with|remaster|live|version|edit|mono|stereo)[^\)\]]*[\)\]]", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+-\s+.*(remaster|live|version|edit|mono|stereo).*$", "", text, flags=re.IGNORECASE)
    return normalize(text)


def match_tracks(tracks: list[SpotifyTrack], library: list[tuple[int, str, str, float]]) -> dict[str, int]:
    """spotify id → song id for the tracks that are already in the library. `library` rows: (song id, artist, title, duration; 0 = not known).

    Same title, the track's first artist among the song's artists (or the other way round), and, when both lengths are known, within 4 s.
    """
    by_title: dict[str, list[tuple[int, str, float]]] = {}
    for song_id, artist, title, duration in library:
        by_title.setdefault(_key(title), []).append((song_id, _key(artist), duration))
    out: dict[str, int] = {}
    for t in tracks:
        first = _key(t.artist.split(",")[0]) if t.artist else ""
        for song_id, artist, duration in by_title.get(_key(t.title), []):
            if duration > 0 and t.duration > 0 and abs(duration - t.duration) > 4:
                continue
            if first and artist and (first in artist or artist in first):
                out[t.spotify_id] = song_id
                break
    return out
