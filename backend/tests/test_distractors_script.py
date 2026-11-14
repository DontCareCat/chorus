import random

from app.services.game.distractors import pick_distractors, script_of


def test_script_of_tells_the_writing_systems_apart():
    assert script_of("работу") == "CYRILLIC"
    assert script_of("love") == "LATIN"
    assert script_of("καλημέρα") == "GREEK"
    assert script_of("123") == "OTHER"


def test_russian_question_gets_only_cyrillic_options_even_when_the_song_has_latin_words():
    vocab = {"baby", "love", "http", "работа", "дорога", "ветер", "город", "солнце", "комната"}
    for seed in range(30):
        got = pick_distractors("работу", "ru", vocab, set(), random.Random(seed))
        assert got is not None and len(got) == 3
        assert all(script_of(w) == "CYRILLIC" for w in got), got


def test_latin_languages_are_unchanged():
    got = pick_distractors("Arbeit", "de", {"Morgen", "Sonne", "Garten"}, set(), random.Random(1))
    assert got is not None and all(script_of(w) == "LATIN" for w in got)
