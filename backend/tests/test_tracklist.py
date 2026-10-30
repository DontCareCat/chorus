import pytest

from app.services.tracklist import TrackRef, match_tracks


def test_match_tracks_by_title_artist_and_length():
    library = [(1, "Rammstein", "Du hast", 234.0), (2, "Nena", "99 Luftballons (Remastered)", 0.0), (3, "Other", "Du hast", 100.0)]
    tracks = [TrackRef("Du Hast", "Rammstein", 235.0), TrackRef("99 Luftballons", "Nena", 233.0), TrackRef("Du hast", "Rammstein", 300.0), TrackRef("Sonne", "Rammstein", 270.0),
              TrackRef("Du hast - Remastered 2020", "Rammstein, Someone", 234.0)]
    m = match_tracks(tracks, library)
    assert m[0] == 1 and m[1] == 2 and m[4] == 1
    assert 2 not in m and 3 not in m  # 66 s apart / not in the library


def test_a_short_artist_name_does_not_match_inside_a_longer_one():
    assert match_tracks([TrackRef("Song", "Sia", 0)], [(1, "Asian Dub Foundation", "Song", 0)]) == {}
    assert match_tracks([TrackRef("Song", "Nena", 0)], [(1, "Nenad", "Song", 0)]) == {}
    assert match_tracks([TrackRef("Song", "Nena", 0)], [(1, "Nena", "Song", 0)]) == {0: 1}


def test_the_api_matches_a_pasted_list(api, tmp_path):
    from tests.conftest import make_wav
    with make_wav(tmp_path / "Rammstein - Du hast.wav", seconds=2).open("rb") as f:
        song = api.post("/api/songs", files={"file": ("Rammstein - Du hast.wav", f, "audio/wav")}).json()
    r = api.post("/api/tracks/match", json={"tracks": [{"title": "Du Hast", "artist": "Rammstein"}, {"title": "Sonne", "artist": "Rammstein"}]})
    assert r.status_code == 200
    assert r.json()["matches"] == [{"index": 0, "song_id": song["id"], "song_title": "Du hast"}]
    assert api.post("/api/tracks/match", json={"tracks": []}).status_code == 422


def test_brackets_are_dropped_by_whole_words_only():
    # "(Alive)" is part of the title; "(Live)" and "(feat. X)" are not
    assert match_tracks([TrackRef("Song (Alive)", "A", 0)], [(1, "A", "Song", 0)]) == {}
    assert match_tracks([TrackRef("Song (Live)", "A", 0)], [(1, "A", "Song", 0)]) == {}  # another recording
    assert match_tracks([TrackRef("Song (feat. Someone)", "A", 0)], [(1, "A", "Song", 0)]) == {0: 1}
    assert match_tracks([TrackRef("Song - 2011 Remaster", "A", 0)], [(1, "A", "Song", 0)]) == {0: 1}
    assert match_tracks([TrackRef("Without Me", "Eminem", 0)], [(1, "Eminem", "Without Me", 0)]) == {0: 1}


def test_accents_and_joined_artists():
    assert match_tracks([TrackRef("Halo", "Beyoncé", 0)], [(1, "Beyonce & Jay-Z", "Halo", 0)]) == {0: 1}


def test_unbracketed_feat_other_alphabets_swapped_order_and_title_only():
    assert match_tracks([TrackRef("Song ft. Someone", "A", 0)], [(1, "A", "Song", 0)]) == {0: 1}
    assert match_tracks([TrackRef("Группа крови", "Кино", 0)], [(1, "Кино", "Группа крови", 0)]) == {0: 1}
    assert match_tracks([TrackRef("Du hast", "Rammstein", 0)], [(1, "Rammstein", "Du hast", 0)]) == {0: 1}
    assert match_tracks([TrackRef("Rammstein", "Du hast", 0)], [(1, "Rammstein", "Du hast", 0)]) == {0: 1}  # "Title - Artist" written backwards
    assert match_tracks([TrackRef("Du hast", "", 0)], [(1, "Rammstein", "Du hast", 0)]) == {0: 1}
    assert match_tracks([TrackRef("Du hast", "", 0)], [(1, "Rammstein", "Du hast", 0), (2, "Other", "Du hast", 0)]) == {}  # ambiguous
    assert match_tracks([TrackRef("Song (Taylor's Version)", "T", 0)], [(1, "T", "Song", 0)]) == {}
