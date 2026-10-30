"""Searching YouTube by artist and name, through the official YouTube Data API v3 with a key the person made (search.list: 100 quota units a call,
10,000 a day free, so about 100 searches a day). Only embeddable videos are asked for. Results are shown, never stored."""
from dataclasses import dataclass

import httpx

from app.core.errors import AppError
from app.services.youtube import YouTubeUnavailable

SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
USER_AGENT = "chorus-app/0.1 (private language-learning app)"


@dataclass
class SearchHit:
    video_id: str
    title: str
    channel: str


class YouTubeSearchClient:
    def __init__(self, http: httpx.Client | None = None):
        self.http = http or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=10)

    def search(self, query: str, key: str, limit: int = 8) -> list[SearchHit]:
        if not key:
            raise AppError("youtube_key_missing", "Searching YouTube needs a YouTube Data API key: add it in Settings.", 422)
        try:
            r = self.http.get(SEARCH_URL, params={
                "part": "snippet", "type": "video", "videoEmbeddable": "true", "videoSyndicated": "true", "maxResults": limit, "q": query, "key": key,
            })
        except httpx.HTTPError as e:
            raise YouTubeUnavailable(str(e)) from e
        if r.status_code in (400, 403):
            try:
                reason = (r.json().get("error", {}).get("errors") or [{}])[0].get("reason", "")
            except ValueError:
                reason = ""
            if reason in ("quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"):
                raise AppError("youtube_quota", "The day's YouTube searches are used up (about 100 a day with one key). Try again tomorrow.", 429)
            raise AppError("youtube_key_invalid", "YouTube did not accept the API key. Check it in Settings (the YouTube Data API v3 must be switched on for it).", 422)
        if r.status_code >= 400:
            raise YouTubeUnavailable(f"YouTube returned HTTP {r.status_code}")
        out = []
        for item in r.json().get("items") or []:
            vid = (item.get("id") or {}).get("videoId")
            sn = item.get("snippet") or {}
            if vid:
                out.append(SearchHit(video_id=vid, title=_unescape(str(sn.get("title") or "")), channel=_unescape(str(sn.get("channelTitle") or ""))))
        return out


def _unescape(text: str) -> str:
    import html

    return html.unescape(text)
