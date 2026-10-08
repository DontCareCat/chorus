import json
import re
from datetime import datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db.models import LyricsCache
from app.db.models.types import utcnow
from app.services.lyrics.lrclib import LrclibClient, LrclibUnavailable, LyricsCandidate


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


class CachedLrclib:
    """LRCLIB lookups cached in the DB. ttl_days == 0 keeps entries forever; stale entries are served if LRCLIB is down."""

    def __init__(self, client: LrclibClient, session: Session, ttl_days: int, now=utcnow):
        self.client, self.session, self.ttl_days, self.now = client, session, ttl_days, now

    def _fresh(self, fetched_at: datetime) -> bool:
        return self.ttl_days == 0 or self.now() - fetched_at < timedelta(days=self.ttl_days)

    def _cached(self, key: str, fetch):
        row = self.session.query(LyricsCache).filter_by(cache_key=key).one_or_none()
        if row is not None and self._fresh(row.fetched_at):
            return json.loads(row.payload)
        try:
            data = fetch()
        except LrclibUnavailable:
            if row is not None:
                return json.loads(row.payload)  # stale beats nothing
            raise
        payload = json.dumps(data)
        if row is None:
            self.session.add(LyricsCache(cache_key=key, payload=payload, fetched_at=self.now()))
        else:
            row.payload, row.fetched_at = payload, self.now()
        self.session.commit()
        return data

    def get(self, artist: str, title: str, album: str | None, duration: float) -> LyricsCandidate | None:
        key = f"get:{_norm(artist)}|{_norm(title)}|{_norm(album or '')}|{round(duration)}"
        data = self._cached(key, lambda: self.client.get(artist, title, album, duration))
        return LyricsCandidate.from_json(data) if data else None

    def get_by_id(self, lrclib_id: int) -> LyricsCandidate | None:
        data = self._cached(f"id:{lrclib_id}", lambda: self.client.get_by_id(lrclib_id))
        return LyricsCandidate.from_json(data) if data else None

    def search(self, query: str) -> list[LyricsCandidate]:
        data = self._cached(f"search:{_norm(query)}", lambda: self.client.search(query))
        return [LyricsCandidate.from_json(j) for j in data]

    def clear(self) -> int:
        n = self.session.execute(delete(LyricsCache)).rowcount
        self.session.commit()
        return n
