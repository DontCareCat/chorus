from datetime import timedelta

from app.db.models import LyricsStatus, Song
from app.db.models.types import utcnow
from app.services.lyrics.stall import is_stalled


def song(status, age_min):
    now = utcnow()
    return Song(lyrics_status=status, created_at=now - timedelta(minutes=age_min)), now


def test_pending_past_the_timeout_is_stalled():
    s, now = song(LyricsStatus.pending, 11)
    assert is_stalled(s, 10, now)


def test_pending_within_the_timeout_is_not():
    s, now = song(LyricsStatus.pending, 9)
    assert not is_stalled(s, 10, now)


def test_finished_lookups_are_never_stalled():
    for st in (LyricsStatus.found, LyricsStatus.not_found, LyricsStatus.needs_choice):
        s, now = song(st, 500)
        assert not is_stalled(s, 10, now)
