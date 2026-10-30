"""The Wiktionary parser against real pages (saved 2026-10-30): the words that came out wrong with the first parser."""
import json
from pathlib import Path

import pytest

from app.services.dictionary import lookup as L

PAGES = json.loads((Path(__file__).parent / "fixtures" / "wiktionary-pages.json").read_text())


class Saved(L.Wiktionary):
    def __init__(self):
        pass

    def page(self, title):
        return PAGES.get(title)


@pytest.fixture
def wk():
    return Saved()


def test_zeit_is_the_noun_not_the_clipping_of_uhrzeit(wk):
    i = wk.info("Zeit", "de", True)
    assert i.lemma is None and i.gender == "f" and i.gloss.startswith("time")
    assert i.gloss not in ("", ")")


def test_warten_as_a_noun_has_a_gender_and_a_meaning(wk):
    i = wk.info("Warten", "de", True)
    assert i.is_noun and i.gender == "n" and i.gloss and "wait" in i.gloss


def test_a_form_goes_to_its_lemma(wk):
    i = wk.info("leiht", "de", False)
    assert i.lemma == "leihen" and "borrow" in i.gloss


def test_line_start_words_and_meanings_are_clean(wk):
    for word in ("Nun", "Wer", "Leiht", "Warten"):
        i = wk.info(word, "de", None)
        assert i.gloss and "(see" not in i.gloss and i.gloss.count("(") == i.gloss.count(")")


def test_clean_gloss_drops_pointers_and_empty_brackets():
    assert L.clean_gloss("who; what, which (one) (see usage notes)") == "who; what, which (one)"
    assert L.clean_gloss("{{clipping of|de|Uhrzeit}})") == ""
    assert L.clean_gloss("()") == ""


def test_a_capitalised_line_start_word_is_not_lowercased_unless_it_is_a_form(wk):
    # "Zeit" at the start of a line: the preposition page must not turn the noun's headword into "zeit"
    i = wk.info("Zeit", "de", None)
    assert i.lemma is None  # so the headword stays as sung
