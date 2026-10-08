import pytest

from app.core.errors import AppError
from app.services.lyrics.lrc import parse_lyrics_text
from app.services.lyrics.normalizer import normalize

LRC = """[ar:Rammstein]
[ti:Du hast]
[00:10.00] First line
[00:15.5]Second line
[00:20.000] ♪
[00:30.00] [Chorus]
[00:31.00] Third <00:31.50>line (x2)
"""


def test_parse_timestamps_and_tags():
    raw = parse_lyrics_text(LRC)
    assert raw.is_synced and raw.tags["ar"] == "Rammstein"
    assert [l.start for l in raw.lines] == [10.0, 15.5, 20.0, 30.0, 31.0]


def test_multiple_timestamps_per_line_sorted():
    raw = parse_lyrics_text("[00:30.00][00:10.00] Chorus\n[00:20.00] Verse")
    assert [(l.start, l.text) for l in raw.lines] == [(10.0, "Chorus"), (20.0, "Verse"), (30.0, "Chorus")]


def test_offset_tag_positive_means_earlier():
    raw = parse_lyrics_text("[offset:500]\n[00:10.00] x")
    assert raw.lines[0].start == 9.5


def test_plain_text_is_unsynced():
    raw = parse_lyrics_text("one\n\ntwo\n")
    assert not raw.is_synced and [l.text for l in raw.lines] == ["one", "two"]


def test_gap_markers_end_previous_line_and_are_not_stored():
    n = normalize(parse_lyrics_text(LRC), duration=100)
    assert [(l.start, l.end, l.text) for l in n.lines] == [
        (10.0, 15.5, "First line"), (15.5, 20.0, "Second line"), (31.0, 36.0, "Third line"),
    ]


def test_long_lines_capped_and_last_line_clamped_to_duration():
    n = normalize(parse_lyrics_text("[00:00.00] a\n[01:00.00] b"), duration=62)
    assert n.lines[0].end == 15.0
    assert n.lines[1].end == 62


def test_duplicate_timestamps_dropped_with_warning():
    n = normalize(parse_lyrics_text("[00:10.00] a\n[00:10.00] b\n[00:12.00] c"), duration=100)
    assert [l.text for l in n.lines] == ["b", "c"] and n.warnings


def test_lyrics_beyond_duration_warns():
    n = normalize(parse_lyrics_text("[00:10.00] a\n[05:00.00] b"), duration=100)
    assert any("different version" in w for w in n.warnings)


def test_unsynced_normalisation_has_no_times():
    n = normalize(parse_lyrics_text("Hello &amp; bye\n[Chorus]\nline"), duration=10)
    assert not n.is_synced and [(l.start, l.end, l.text) for l in n.lines] == [(None, None, "Hello & bye"), (None, None, "line")]


def test_empty_lyrics_rejected():
    with pytest.raises(AppError):
        normalize(parse_lyrics_text("[00:10.00] ♪"), duration=10)
