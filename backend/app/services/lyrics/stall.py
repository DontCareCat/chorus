from datetime import datetime, timedelta

from app.db.models import LyricsStatus, Song


def is_stalled(song: Song, timeout_minutes: int, now: datetime) -> bool:
    """A song still waiting for lyrics `timeout_minutes` after it was added (the first lookup starts on import)."""
    return song.lyrics_status == LyricsStatus.pending and now - song.created_at > timedelta(minutes=timeout_minutes)
