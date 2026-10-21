"""Review scheduling, in the style of AnkiDroid's four buttons.

A card has an interval (seconds) after its last review; each button sets the *minimum* time before the card comes
back. Every button except Again makes the interval longer with each review, and Again starts over:

    learning (interval under a day)   Again 1 min | Hard 10 min, then x1.5 | Good 1 day | Easy 4 days
    review   (a day or more)          Again 1 min | Hard x1.2 | Good x2.5 | Easy x4

Nothing grows past a year. A card that was never reviewed is in the learning stage with interval 0.
"""
from datetime import datetime, timedelta

MINUTE = 60
DAY = 86400
MAX_INTERVAL = 365 * DAY
RATINGS = ("again", "hard", "good", "easy")


def next_interval(current: int, rating: str) -> int:
    """The interval (seconds) the button would give a card whose interval is now `current`."""
    if rating == "again":
        return MINUTE
    if current < DAY:
        out = {"hard": max(10 * MINUTE, int(current * 1.5)), "good": DAY, "easy": 4 * DAY}[rating]
    else:
        out = {"hard": int(current * 1.2), "good": int(current * 2.5), "easy": current * 4}[rating]
    return min(out, MAX_INTERVAL)


def intervals(current: int) -> dict[str, int]:
    return {r: next_interval(current, r) for r in RATINGS}


def review(entry, rating: str, now: datetime) -> None:
    """Apply a rating to a dictionary entry (sets interval, due date and the counters)."""
    if rating not in RATINGS:
        raise ValueError(f"unknown rating {rating!r}")
    entry.interval_seconds = next_interval(entry.interval_seconds or 0, rating)
    entry.due_at = now + timedelta(seconds=entry.interval_seconds)
    entry.last_reviewed_at = now
    if entry.introduced_at is None:
        entry.introduced_at = now
    if rating == "again":
        entry.lapses = (entry.lapses or 0) + 1
    else:
        entry.reps = (entry.reps or 0) + 1
