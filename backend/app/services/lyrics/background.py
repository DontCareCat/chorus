import logging

from sqlalchemy.orm import sessionmaker

from app.db.models import Song
from app.services.lyrics.cache import CachedLrclib
from app.services.lyrics.discovery import discover_lyrics
from app.services.lyrics.lrclib import LrclibClient
from app.services.settings import load_settings

log = logging.getLogger(__name__)


def discover_for_songs(factory: sessionmaker, client: LrclibClient, song_ids: list[int]) -> None:
    """Background task: automatic lyrics discovery for newly added songs (own DB session)."""
    for song_id in song_ids:
        with factory() as session:
            cfg = load_settings(session)
            if not cfg.auto_fetch_lyrics:
                return
            song = session.get(Song, song_id)
            if song is None:
                continue
            try:
                discover_lyrics(session, song, CachedLrclib(client, session, cfg.lyrics_cache_ttl_days), cfg, skip_if_has_lyrics=True)
            except Exception:
                log.exception("lyrics discovery failed for song %s", song_id)
