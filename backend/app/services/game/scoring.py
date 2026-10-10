"""Scoring rules. Mirrored in frontend/src/game/scoring.ts; both are tested against the same vectors.

- A correct answer scores (POINTS + AHEAD_BONUS if answered ahead of the playhead) x the current multiplier.
- The multiplier is 1 + one level per STREAK_STEP correct answers in a row, up to MAX_MULTIPLIER.
- A wrong answer scores nothing and drops the streak (multiplier back to x1).
- While the game waits for an answer, every DECAY_SECONDS of waiting costs one multiplier level.

Typing mode (the player types the word): a full match is worth TYPING_FULL, a partial match TYPING_PARTIAL, both x1.5 when
answered ahead (instead of the flat AHEAD_BONUS), then x the streak multiplier. A full match adds to the streak, a partial
one keeps it as it is, a wrong answer resets it.
"""
from dataclasses import dataclass

POINTS = 10
AHEAD_BONUS = 15
STREAK_STEP = 4
MAX_MULTIPLIER = 8
DECAY_SECONDS = 5
TYPING_FULL = 10
TYPING_PARTIAL = 5
TYPING_AHEAD = 1.5  # typing mode: answering ahead of the song multiplies the answer's points
MAX_WAIT_SECONDS = 600  # a client cannot claim more than this for one question


def multiplier_for(streak: int) -> int:
    return min(MAX_MULTIPLIER, 1 + streak // STREAK_STEP)


def decay(streak: int, waited: float) -> int:
    """The streak after `waited` seconds of the game waiting: one level lost per DECAY_SECONDS, progress cleared."""
    levels = int(max(0.0, min(waited, MAX_WAIT_SECONDS)) // DECAY_SECONDS)
    for _ in range(levels):
        level = multiplier_for(streak)
        streak = STREAK_STEP * (level - 2) if level > 1 else 0
    return streak


@dataclass(frozen=True)
class Outcome:
    points: int
    multiplier: int  # the multiplier this answer was scored with
    streak: int  # the streak afterwards
    next_multiplier: int


def score_answer(streak: int, correct: bool, ahead: bool, waited: float = 0.0) -> Outcome:
    streak = decay(streak, waited)
    applied = multiplier_for(streak)
    if not correct:
        return Outcome(0, applied, 0, 1)
    points = (POINTS + (AHEAD_BONUS if ahead else 0)) * applied
    streak += 1
    return Outcome(points, applied, streak, multiplier_for(streak))


def score_typed(streak: int, match: str, ahead: bool, waited: float = 0.0) -> Outcome:
    streak = decay(streak, waited)
    applied = multiplier_for(streak)
    if match == "none":
        return Outcome(0, applied, 0, 1)
    base = TYPING_FULL if match == "full" else TYPING_PARTIAL
    points = int(base * (TYPING_AHEAD if ahead else 1) * applied + 0.5)  # half up
    new_streak = streak + 1 if match == "full" else streak
    return Outcome(points, applied, new_streak, multiplier_for(new_streak))
