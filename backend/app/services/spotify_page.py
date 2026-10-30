"""A public Spotify playlist, read from its embed page (open.spotify.com/embed/playlist/<id>) as the embedded player itself reads it.

Spotify's Web API no longer gives an app the tracks of other people's playlists (February 2026), and this page is not an official interface:
it can change or stop working without notice, which is reported as such. Only titles, artists and lengths are read; nothing is stored.
"""
import json
import re
from dataclasses import dataclass

import httpx

from app.core.errors import AppError
from app.services.tracklist import TrackRef

EMBED_URL = "https://open.spotify.com/embed/playlist/"
USER_AGENT = "chorus-app/0.1 (private language-learning app)"
_ID = re.compile(r"^[A-Za-z0-9]{22}$")
_NEXT = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)


def parse_playlist_id(text: str) -> str | None:
    """The 22-character id of an open.spotify.com/playlist/… link (any ?si= / utm parameters) or a spotify:playlist:… uri."""
    from urllib.parse import urlparse

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
    if len(parts) > 1 and parts[0].startswith("intl-"):
        parts = parts[1:]
    if len(parts) >= 2 and parts[0] == "playlist" and _ID.match(parts[1]):
        return parts[1]
    return None


def parse_track_id(text: str) -> str | None:
    """The 22-character id of an open.spotify.com/track/… link (any ?si= parameters) or a spotify:track:… uri."""
    from urllib.parse import urlparse

    text = text.strip()
    m = re.fullmatch(r"spotify:track:([A-Za-z0-9]{22})", text)
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
    if len(parts) > 1 and parts[0].startswith("intl-"):
        parts = parts[1:]
    if len(parts) >= 2 and parts[0] == "track" and _ID.match(parts[1]):
        return parts[1]
    return None


@dataclass
class SpotifyTrack(TrackRef):
    spotify_id: str = ""


@dataclass
class SpotifyPlaylist:
    name: str
    owner: str
    tracks: list[SpotifyTrack]


class SpotifyUnavailable(Exception):
    """Spotify could not be reached."""


def parse_embed(html: str) -> SpotifyPlaylist | None:
    """The playlist in an embed page, or None when the page does not hold one in the shape known (the page changed, or the list is private)."""
    m = _NEXT.search(html)
    if not m:
        return None
    try:
        entity = json.loads(m.group(1))["props"]["pageProps"]["state"]["data"]["entity"]
        items = entity["trackList"]
    except (ValueError, KeyError, TypeError):
        return None
    if entity.get("type") != "playlist" or not isinstance(items, list):
        return None
    tracks = []
    for t in items:
        uri = str(t.get("uri") or "")
        title = str(t.get("title") or "").strip()
        if not uri.startswith("spotify:track:") or not title:
            continue  # an episode, or a local file
        tracks.append(SpotifyTrack(
            title=title, artist=re.sub(r"\s+", " ", str(t.get("subtitle") or "")).strip(), duration=float(t.get("duration") or 0) / 1000,
            spotify_id=uri.rsplit(":", 1)[-1],
        ))
    return SpotifyPlaylist(name=str(entity.get("name") or entity.get("title") or ""), owner=str(entity.get("subtitle") or ""), tracks=tracks)


def parse_track_embed(html: str) -> SpotifyTrack | None:
    """The track in an embed page, or None when the page does not hold one in the shape known."""
    m = _NEXT.search(html)
    if not m:
        return None
    try:
        e = json.loads(m.group(1))["props"]["pageProps"]["state"]["data"]["entity"]
    except (ValueError, KeyError, TypeError):
        return None
    title = str(e.get("name") or e.get("title") or "").strip() if isinstance(e, dict) else ""
    if not isinstance(e, dict) or e.get("type") != "track" or not title:
        return None
    artists = ", ".join(str(a.get("name") or "") for a in e.get("artists") or [] if isinstance(a, dict) and a.get("name"))
    return SpotifyTrack(title=title, artist=artists, duration=float(e.get("duration") or 0) / 1000, spotify_id=str(e.get("id") or ""))


class SpotifyPageClient:
    def __init__(self, http: httpx.Client | None = None):
        self.http = http or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=12, follow_redirects=True)

    def playlist(self, playlist_id: str) -> SpotifyPlaylist:
        try:
            r = self.http.get(EMBED_URL + playlist_id)
        except httpx.HTTPError as e:
            raise SpotifyUnavailable(str(e)) from e
        if r.status_code == 404:
            raise AppError("spotify_playlist_unavailable", "That playlist does not exist or is private. Only public playlists can be read.", 422)
        if r.status_code >= 400:
            raise SpotifyUnavailable(f"Spotify returned HTTP {r.status_code}")
        found = parse_embed(r.text)
        if found is None or not found.tracks:
            raise AppError(
                "spotify_page_unreadable", "Spotify's page gave no songs for that playlist: it is private, empty, or Spotify changed its page. "
                "You can paste the songs instead (Import a song list).", 422,
            )
        return found

    def track(self, track_id: str) -> SpotifyTrack:
        try:
            r = self.http.get(EMBED_URL.replace("/playlist/", "/track/") + track_id)
        except httpx.HTTPError as e:
            raise SpotifyUnavailable(str(e)) from e
        if r.status_code == 404:
            raise AppError("spotify_track_unavailable", "That song does not exist.", 422)
        if r.status_code >= 400:
            raise SpotifyUnavailable(f"Spotify returned HTTP {r.status_code}")
        found = parse_track_embed(r.text)
        if found is None:
            raise AppError("spotify_page_unreadable", "Spotify's page gave no song for that link: Spotify may have changed its page. Search for the song by its name instead.", 422)
        return found
