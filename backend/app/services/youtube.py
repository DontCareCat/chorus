"""YouTube songs: link parsing, title cleaning and the video's public facts (oEmbed, no API key).

Only the video id and the user's own data are kept. The video itself is played by YouTube's own player in the browser.
"""
import re
from dataclasses import dataclass
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
