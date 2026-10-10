import json
from pathlib import Path

import pytest

from app.services.game import scoring
from app.services.game.matching import edit_distance, judge, normalize


@pytest.mark.parametrize("typed, word, expected", [
    # full: case, accents, punctuation and spaces do not matter
    ("Arbeit", "Arbeit", "full"), ("arbeit", "Arbeit", "full"), ("  ARBEIT ", "arbeit", "full"),
    ("ubung", "Übung", "full"), ("Übung", "ubung", "full"), ("cafe", "café", "full"), ("don't", "dont", "full"),
    ("ich-bin", "ichbin", "full"), ("straße", "STRASSE", "full"),  # case folding turns ß into ss
    # partial: typos
    ("Arbiet", "Arbeit", "partial"),  # swapped neighbours
    ("Arbet", "Arbeit", "partial"), ("Arbeitt", "Arbeit", "partial"), ("Arbeot", "Arbeit", "partial"),
    ("Hous", "Haus", "partial"),
    ("Wohnnug", "Wohnung", "partial"), ("Wonung", "Wohnung", "partial"), ("Wohnng", "Wohnung", "partial"),
    # partial: cut short (>= 60 %) or with an ending added
    ("Wohnu", "Wohnung", "partial"), ("Bahnh", "Bahnhof", "partial"), ("gehst", "geh", "partial"), ("Arbeiten", "Arbeit", "partial"),
    # wrong
    ("Schule", "Arbeit", "none"), ("Wo", "Wohnung", "none"), ("Woh", "Wohnung", "none"),  # too little of the word
    ("Haus", "Maus", "partial"), ("Haus", "Baum", "none"), ("", "Arbeit", "none"), ("   ", "Arbeit", "none"), ("!!!", "Arbeit", "none"),
    ("ab", "ob", "none"),  # words of 2 letters allow no typo
    ("Wohnungsbau", "Wohnung", "partial"), ("Wohnungsbaugesellschaft", "Wohnung", "partial"),
])
def test_judge(typed, word, expected):
    assert judge(typed, word) == expected, (typed, word)


def test_short_words():
    assert judge("ich", "ihr") == "none"  # two letters differ
    assert judge("ic", "ich") == "partial"  # one letter missing: a typo, even though it is not 60 % cut short
    assert judge("i", "ich") == "none"
    assert judge("ab", "ob") == "none"  # words of two letters allow no typo at all
    assert judge("", "") == "none"


def test_normalize_and_distance():
    assert normalize("Ärger-Mäßig!") == "argermassig"
    assert edit_distance("abc", "abc") == 0 and edit_distance("abc", "acb") == 1 and edit_distance("", "abc") == 3
    assert edit_distance("kitten", "sitting") == 3


VECTORS = json.loads((Path(__file__).resolve().parents[2] / "shared" / "scoring-typing-vectors.json").read_text())["cases"]


@pytest.mark.parametrize("case", VECTORS, ids=[c["name"] for c in VECTORS])
def test_typing_scoring_vectors(case):
    streak = 0
    for step, expected in zip(case["steps"], case["expect"], strict=True):
        out = scoring.score_typed(streak, step["match"], step["ahead"], step["waited"])
        assert [out.points, out.multiplier, out.streak, out.next_multiplier] == expected, step
        streak = out.streak
