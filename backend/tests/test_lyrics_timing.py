import pytest

from app.services.lyrics.lrc_writer import build_lrc, file_name, length_tag, stamp
from tests.conftest import make_wav
from tests.test_api_games import LRC, PLAIN, new_game
from tests.test_api_library import upload


@pytest.fixture
def song(api, tmp_path):
    s = upload(api, make_wav(tmp_path / "Band - Lied.wav", seconds=40)).json()
    api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("l.lrc", LRC.encode(), "text/plain")})
    return s


def times(api, song):
    return [l["time"] for l in api.get(f"/api/songs/{song['id']}/lyrics/timing").json()["lines"]]


def test_writer_stamps_and_file_name():
    assert stamp(0) == "[00:00.00]" and stamp(55.6) == "[00:55.60]" and stamp(61.005) == "[01:01.01]" and stamp(6000) == "[100:00.00]"
    assert length_tag(225) == "3:45"
    assert file_name("Mara Vell", "Paper Lanterns") == "Mara Vell - Paper Lanterns.lrc"
    assert file_name("AC/DC", 'Who Made "Who"?') == "AC_DC - Who Made _Who__.lrc"
    assert file_name("", "Solo") == "Solo.lrc"


def test_writer_header_empty_line_and_untimed_lines():
    text = build_lrc("Paper Lanterns", "Mara Vell", "Río de papel", 225.0, [(12.4, "Las luces"), (34.2, ""), (None, "left out")])
    assert text == "[ti:Paper Lanterns]\n[ar:Mara Vell]\n[al:Río de papel]\n[length:3:45]\n[re:Chorus]\n[00:12.40]Las luces\n[00:34.20]\n"
    assert build_lrc("T", "", None, 0, [(1, "x")]) == "[ti:T]\n[re:Chorus]\n[00:01.00]x\n"


def test_timing_view_save_and_reset(api, song):
    base = times(api, song)
    assert base == [0, 5, 10, 15, 20, 25]
    r = api.get(f"/api/songs/{song['id']}/lyrics/timing").json()
    assert r["edited"] is False and r["lines"][1]["original"] == 5 and r["lines"][1]["text"].startswith("Du hast")
    new = [0.5, 6.25, 10, 15, 21, 25]
    put = api.put(f"/api/songs/{song['id']}/lyrics/timing", json={"times": new})
    assert put.status_code == 200 and put.json()["edited"] is True and [l["time"] for l in put.json()["lines"]] == new
    assert next(s for s in api.get("/api/songs").json() if s["id"] == song["id"])["timing_edited"] is True
    lyr = api.get(f"/api/songs/{song['id']}/lyrics").json()
    assert [l["start_time"] for l in lyr["lines"]] == new and lyr["lines"][0]["end_time"] == 6.25
    # the text is never touched and the API takes no text
    assert [l["text"] for l in lyr["lines"]][0] == "Ich gehe jeden Morgen zur Arbeit"
    # saving the original times again removes the edit
    api.put(f"/api/songs/{song['id']}/lyrics/timing", json={"times": base})
    assert api.get(f"/api/songs/{song['id']}/lyrics/timing").json()["edited"] is False
    api.put(f"/api/songs/{song['id']}/lyrics/timing", json={"times": new})
    r = api.delete(f"/api/songs/{song['id']}/lyrics/timing")
    assert r.status_code == 200 and r.json()["edited"] is False and times(api, song) == base


def test_timing_validation(api, song):
    url = f"/api/songs/{song['id']}/lyrics/timing"
    assert api.put(url, json={"times": [0, 1]}).status_code == 400  # wrong number of lines
    assert api.put(url, json={"times": [0, 5, 4, 15, 20, 25]}).status_code == 400  # order
    assert api.put(url, json={"times": [-1, 5, 10, 15, 20, 25]}).status_code == 400
    assert api.put(url, json={"times": [0, 5, 10, 15, 20, 99]}).status_code == 400  # past the end of the song (40 s)
    assert api.put(url, json={"times": [0, 5, 10, 15, 20, "x"]}).status_code == 422
    assert api.get("/api/songs/9999/lyrics/timing").status_code == 404


def test_offset_is_folded_in_when_saving(api, song):
    api.patch(f"/api/songs/{song['id']}", json={"lyrics_offset": 1.5})
    assert times(api, song)[0] == 1.5  # the editor opens with original + offset
    api.put(f"/api/songs/{song['id']}/lyrics/timing", json={"times": times(api, song)})
    s = next(x for x in api.get("/api/songs").json() if x["id"] == song["id"])
    assert s["lyrics_offset"] == 0 and times(api, song) == [1.5, 6.5, 11.5, 16.5, 21.5, 26.5]


def test_edited_times_reach_the_game_questions_and_lines(api, song):
    g0 = new_game(api, song)
    qs0 = {q["line_id"] for q in g0["questions"]}
    new = [0, 6, 11, 16, 21, 26]
    api.put(f"/api/songs/{song['id']}/lyrics/timing", json={"times": new})
    g = api.get(f"/api/games/{g0['public_id']}").json()
    starts = {l["line_id"]: l["audio_start"] for l in g["lines"]}
    assert sorted(starts.values()) == new
    for q in g["questions"]:
        assert q["audio_start"] == starts[q["line_id"]]
    assert qs0 == {q["line_id"] for q in g["questions"]}  # the same questions, moved with their lines


def test_different_lyrics_drop_the_edit_same_lines_keep_it(api, song):
    url = f"/api/songs/{song['id']}/lyrics"
    api.put(url + "/timing", json={"times": [0, 6, 11, 16, 21, 26]})
    api.post(url + "/upload", files={"file": ("l.lrc", LRC.encode(), "text/plain")})  # the very same lines
    assert api.get(url + "/timing").json()["edited"] is True
    other = LRC.replace("Mond", "Sonne")
    api.post(url + "/upload", files={"file": ("l.lrc", other.encode(), "text/plain")})
    assert api.get(url + "/timing").json()["edited"] is False


def test_export_lrc(api, song):
    api.put(f"/api/songs/{song['id']}/lyrics/timing", json={"times": [0.5, 6, 11, 16, 21, 26]})
    r = api.get(f"/api/songs/{song['id']}/lyrics.lrc")
    assert r.status_code == 200 and r.headers["content-disposition"].startswith("attachment; filename*=UTF-8''")
    lines = r.content.decode("utf-8").split("\n")
    assert lines[0] == "[ti:Lied]" and "[re:Chorus]" in lines and "[00:00.50]Ich gehe jeden Morgen zur Arbeit" in lines
    assert r.content.endswith(b"\n") and not r.content.startswith(b"\xef\xbb\xbf")


def test_plain_lyrics_can_be_timed_and_export_needs_a_time(api, tmp_path):
    s = upload(api, make_wav(tmp_path / "Band - Plain.wav", seconds=40)).json()
    api.put("/api/settings", json={**api.get("/api/settings").json(), "allow_unsynchronized_lyrics": True})
    assert api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("p.txt", PLAIN.encode(), "text/plain")}).status_code == 201
    v = api.get(f"/api/songs/{s['id']}/lyrics/timing").json()
    assert v["synced"] is False and all(l["time"] is None for l in v["lines"])
    assert api.get(f"/api/songs/{s['id']}/lyrics.lrc").status_code == 409
    n = len(v["lines"])
    partial = [None] * n
    partial[0] = 1.0
    assert api.put(f"/api/songs/{s['id']}/lyrics/timing", json={"times": partial}).status_code == 200
    assert api.get(f"/api/songs/{s['id']}/lyrics").json()["is_synced"] is False  # not every line has a time yet
    assert api.get(f"/api/songs/{s['id']}/lyrics.lrc").status_code == 200
    api.put(f"/api/songs/{s['id']}/lyrics/timing", json={"times": [1.0 + i * 5 for i in range(n)]})
    assert api.get(f"/api/songs/{s['id']}/lyrics").json()["is_synced"] is True
    g = new_game(api, s)
    assert g["synced"] is True and sorted(l["audio_start"] for l in g["lines"]) == [1.0 + i * 5 for i in range(n)]


def test_no_lyrics_gives_404(api, tmp_path):
    s = upload(api, make_wav(tmp_path / "Band - Nothing.wav", seconds=3)).json()
    assert api.get(f"/api/songs/{s['id']}/lyrics/timing").status_code == 404
    assert api.get(f"/api/songs/{s['id']}/lyrics.lrc").status_code == 404
