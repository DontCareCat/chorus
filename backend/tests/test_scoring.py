import json
from pathlib import Path

import pytest

from app.services.game import scoring

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "shared" / "scoring-vectors.json").read_text())["cases"]


@pytest.mark.parametrize("case", VECTORS, ids=[c["name"] for c in VECTORS])
def test_shared_vectors(case):
    streak = 0
    for step, expected in zip(case["steps"], case["expect"], strict=True):
        out = scoring.score_answer(streak, step["correct"], step["ahead"], step["waited"])
        assert [out.points, out.multiplier, out.streak, out.next_multiplier] == expected, step
        streak = out.streak


def test_multiplier_levels():
    assert [scoring.multiplier_for(n) for n in (0, 3, 4, 7, 8, 27, 28, 29, 500)] == [1, 1, 2, 2, 3, 7, 8, 8, 8]


def test_decay_is_bounded():
    assert scoring.decay(28, 10_000) == 0
    assert scoring.decay(28, -3) == 28
