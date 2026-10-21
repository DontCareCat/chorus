from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.services.dictionary import srs
from app.services.dictionary.srs import DAY, MINUTE

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def test_first_steps_of_a_new_card():
    assert srs.intervals(0) == {"again": MINUTE, "hard": 10 * MINUTE, "good": DAY, "easy": 4 * DAY}


@pytest.mark.parametrize("rating", ["hard", "good", "easy"])
def test_every_button_but_again_grows_with_each_review(rating):
    interval, seen = 0, []
    for _ in range(12):
        interval = srs.next_interval(interval, rating)
        seen.append(interval)
    assert all(b > a for a, b in zip(seen, seen[1:]) if b < srs.MAX_INTERVAL), seen
    assert seen[-1] <= srs.MAX_INTERVAL


def test_hard_in_learning_progresses_before_a_day():
    a = srs.next_interval(0, "hard")
    b = srs.next_interval(a, "hard")
    assert (a, b) == (600, 900)


def test_review_stage_factors():
    assert srs.intervals(10 * DAY) == {"again": MINUTE, "hard": 12 * DAY, "good": 25 * DAY, "easy": 40 * DAY}


def test_hard_in_review_is_one_fifth_longer():
    assert srs.next_interval(DAY, "hard") == int(DAY * 1.2)


def test_buttons_are_ordered_hard_good_easy():
    for interval in (0, 600, DAY, 7 * DAY, 100 * DAY):
        i = srs.intervals(interval)
        assert i["again"] <= i["hard"] <= i["good"] <= i["easy"]


def test_again_starts_over_and_counts_a_lapse():
    e = SimpleNamespace(interval_seconds=30 * DAY, due_at=None, last_reviewed_at=None, introduced_at=None, reps=5, lapses=0)
    srs.review(e, "again", NOW)
    assert (e.interval_seconds, e.lapses, e.reps) == (MINUTE, 1, 5)
    assert (e.due_at - NOW).total_seconds() == MINUTE and e.introduced_at == NOW


def test_review_sets_the_due_date():
    e = SimpleNamespace(interval_seconds=0, due_at=None, last_reviewed_at=None, introduced_at=None, reps=0, lapses=0)
    srs.review(e, "good", NOW)
    assert (e.due_at - NOW).total_seconds() == DAY and e.reps == 1 and e.last_reviewed_at == NOW


def test_cap_and_bad_rating():
    assert srs.next_interval(300 * DAY, "easy") == srs.MAX_INTERVAL
    with pytest.raises(ValueError):
        srs.review(SimpleNamespace(interval_seconds=0, introduced_at=None, reps=0, lapses=0), "meh", NOW)
