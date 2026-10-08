from types import SimpleNamespace

import pytest

from app.core.errors import AppError
from app.services.game.generator import (
    BLANK, DIFFICULTIES, DIFFICULTY_PERCENT, build_drafts, question_target, select_lines,
)
from app.services.game.nlp import tokenize

LINES = [
    "Ich gehe jeden Morgen zur Arbeit",
    "Du hast mich gefragt und ich hab nichts gesagt",
    "Wir fahren mit dem Zug zum Bahnhof",
    "Die Sonne scheint über der Stadt",
    "Ich liebe meine kleine Wohnung sehr",
    "Der Mond steht hoch am Himmel heute",
    "Im Garten blühen rote Blumen",
    "Das Kind spielt mit dem kleinen Hund",
    "Wir trinken Kaffee am frühen Morgen",
    "Die Straße ist voller bunter Lichter",
]


def lyr(lines=LINES, id=1):
    ls = [SimpleNamespace(id=i + 1, sequence=i, text=t, start_time=float(i * 5), end_time=float(i * 5 + 4)) for i, t in enumerate(lines)]
    return SimpleNamespace(id=id, lines=ls)


def total_words(lyrics):
    return sum(len(tokenize(l.text)) for l in select_lines(lyrics.lines))


def test_tokenize_handles_umlauts_and_apostrophes():
    assert [t.text for t in tokenize("Über den Wolken, don't stop – 3 mal!")] == ["Über", "den", "Wolken", "don't", "stop", "mal"]


def test_four_levels_with_the_requested_percentages():
    assert DIFFICULTY_PERCENT == {"easy": 10, "medium": 30, "hard": 60, "expert": 80}
    assert DIFFICULTIES == ("easy", "medium", "hard", "expert")


def test_question_target_is_a_share_of_the_words():
    assert [question_target(100, d) for d in DIFFICULTIES] == [10, 30, 60, 80]
    assert question_target(3, "easy") == 1  # never zero
    assert question_target(10_000, "expert") == 500  # sane upper bound


@pytest.mark.parametrize("difficulty", DIFFICULTIES)
def test_number_of_questions_matches_the_percentage(difficulty):
    lyrics = lyr()
    total = total_words(lyrics)
    drafts = build_drafts(lyrics, "de", difficulty)
    want = question_target(total, difficulty)
    assert abs(len(drafts) - want) <= max(2, round(want * 0.1)), (difficulty, len(drafts), want, total)


def test_more_difficult_levels_ask_strictly_more_questions():
    counts = [len(build_drafts(lyr(), "de", d)) for d in DIFFICULTIES]
    assert counts == sorted(counts) and len(set(counts)) == 4, counts


@pytest.mark.parametrize("difficulty", DIFFICULTIES)
def test_every_question_is_wellformed(difficulty):
    for d in build_drafts(lyr(), "de", difficulty):
        texts = [t for t, _ in d.options]
        assert len(texts) == 4 and len({t.lower() for t in texts}) == 4
        assert sum(ok for _, ok in d.options) == 1
        assert [t for t, ok in d.options if ok] == [d.word]
        words = {t.text.lower() for t in tokenize(d.line.text)}
        assert all(t.lower() not in words for t, ok in d.options if not ok)  # no distractor already in the line


@pytest.mark.parametrize("difficulty", ["medium", "expert"])
def test_a_sentence_hides_all_blanks_of_its_line_and_never_leaks_an_answer(difficulty):
    drafts = build_drafts(lyr(), "de", difficulty)
    by_line: dict[int, list] = {}
    for d in drafts:
        by_line.setdefault(d.line.id, []).append(d)
    assert any(len(v) > 1 for v in by_line.values())  # several questions on one line do occur
    for group in by_line.values():
        assert {d.sentence for d in group} == {group[0].sentence}  # same sentence for every question of the line
        assert [d.blank_index for d in group] == list(range(len(group)))
        sentence = group[0].sentence
        assert sentence.count(BLANK) == len(group)
        # filling the blanks left to right with the right words restores the original line
        filled = sentence
        for d in group:
            filled = filled.replace(BLANK, d.word, 1)
        assert filled == group[0].line.text
        # no blanked word is still readable in the sentence
        remaining = {t.text.lower() for t in tokenize(sentence)}
        assert all(d.word.lower() not in remaining for d in group)
        # at least one word of every line stays visible
        assert len(tokenize(sentence)) >= 1


def test_content_words_come_before_function_words():
    from app.services.game.nlp import zipf

    easy = build_drafts(lyr(), "de", "easy")
    assert all(zipf(d.word, "de") < 6.0 and len(d.word) >= 3 for d in easy)  # 10%: only real content words
    expert = build_drafts(lyr(), "de", "expert")
    assert any(zipf(d.word, "de") >= 6.0 or len(d.word) < 3 for d in expert)  # 80% must reach function words


def test_questions_are_spread_over_the_song():
    lines_hit = {d.line.id for d in build_drafts(lyr(), "de", "medium")}
    assert len(lines_hit) >= 5  # not all crammed into a few lines


def test_function_word_answers_get_function_word_distractors():
    from app.services.game.nlp import zipf

    for d in build_drafts(lyr(), "de", "expert"):
        if zipf(d.word, "de") >= 6.0:
            others = [t for t, ok in d.options if not ok]
            assert all(zipf(o, "de") >= 4.5 for o in others), (d.word, others)


def test_generation_is_deterministic_and_seed_dependent():
    a = [(d.word, d.options) for d in build_drafts(lyr(), "de", "hard")]
    assert a == [(d.word, d.options) for d in build_drafts(lyr(), "de", "hard")]
    assert a != [(d.word, d.options) for d in build_drafts(lyr(id=2), "de", "hard")]


def test_capitalisation_shape_is_kept():
    for d in build_drafts(lyr(), "de", "hard"):
        if len(d.word) > 1 and d.word[0].isupper() and not d.word.isupper():
            assert all(t[0].isupper() for t, _ in d.options)


def test_function_words_are_the_fallback_when_a_song_has_no_content_words():
    drafts = build_drafts(lyr(["und der die das", "ich bin da und du"]), "de", "expert")
    assert drafts and all(len(d.options) == 4 for d in drafts)


def test_repeated_and_short_lines_dropped():
    lines = lyr(["Du hast mich gefragt", "du hast  mich GEFRAGT", "ja ja"]).lines
    assert len(select_lines(lines)) == 1


def test_word_repeated_in_line_is_never_blanked():
    for d in build_drafts(lyr(["Sonne Sonne Sonne scheint hell heute"]), "de", "expert"):
        assert d.word.lower() != "sonne"


def test_unsupported_language_rejected():
    with pytest.raises(AppError) as e:
        build_drafts(lyr(), "ja", "easy")
    assert e.value.code == "language_not_supported"
