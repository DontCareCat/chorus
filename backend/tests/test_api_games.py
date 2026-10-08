import pytest

from tests.conftest import make_wav
from tests.test_api_library import upload

LRC = "\n".join(
    f"[00:{i * 5:02d}.00] {t}"
    for i, t in enumerate([
        "Ich gehe jeden Morgen zur Arbeit",
        "Du hast mich gefragt und ich hab nichts gesagt",
        "Wir fahren mit dem Zug zum Bahnhof",
        "Die Sonne scheint über der Stadt",
        "Ich liebe meine kleine Wohnung sehr",
        "Der Mond steht hoch am Himmel heute",
    ])
)
PLAIN = "\n".join(l.split("] ", 1)[1] for l in LRC.splitlines())


@pytest.fixture
def song(api, tmp_path):
    s = upload(api, make_wav(tmp_path / "Band - Lied.wav", seconds=40)).json()
    api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("l.lrc", LRC.encode(), "text/plain")})
    return s


def new_game(api, song, difficulty="medium"):
    r = api.post("/api/games", json={"song_id": song["id"], "difficulty": difficulty})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_game_payload_hides_answers(api, song):
    g = new_game(api, song)
    assert g["synced"] is True and g["language"] == "de" and g["lyrics_offset"] == 0
    assert (g["song_title"], g["song_artist"]) == ("Lied", "Band")
    assert g["song_duration"] == pytest.approx(40, abs=0.1)
    assert g["progress"] == {"answered": 0, "total": len(g["questions"]), "score": 0}
    q = g["questions"][0]
    assert q["text"] is None and q["answer"] is None
    assert len(q["options"]) == 4 and all(set(o) == {"id", "text"} for o in q["options"])
    assert "____" in q["question_text"]
    assert q["audio_start"] is not None and q["audio_end"] > q["audio_start"]
    assert [x["audio_start"] for x in g["questions"]] == sorted(x["audio_start"] for x in g["questions"])


def test_questions_are_cached_across_games(api, song):
    a, b = new_game(api, song), new_game(api, song)
    assert a["public_id"] != b["public_id"]
    assert [q["id"] for q in a["questions"]] == [q["id"] for q in b["questions"]]
    assert [q["id"] for q in new_game(api, song, "hard")["questions"]] != [q["id"] for q in a["questions"]]


def find_correct(api, g, q):
    """Test helper: the API hides the right answer, so probe it with one throwaway game per option
    (answers are idempotent: within one game the first answer stands)."""
    for o in q["options"]:
        scratch = api.post("/api/games", json={"song_id": g["song_id"], "difficulty": g["difficulty"]}).json()
        r = api.post(f"/api/games/{scratch['public_id']}/answers", json={"question_id": q["id"], "option_id": o["id"]}).json()
        if r["correct"]:
            return o["id"]


def test_answer_flow_score_reveal_and_finish(api, song):
    g = new_game(api, song)
    pid = g["public_id"]
    q0 = g["questions"][0]
    right = find_correct(api, g, q0)
    r = api.post(f"/api/games/{pid}/answers", json={"question_id": q0["id"], "option_id": right}).json()
    assert r["correct"] and r["score"] == 1 and r["correct_option_id"] == right and "____" not in r["text"]
    wrong = next(o["id"] for o in g["questions"][1]["options"] if o["id"] != find_correct(api, g, g["questions"][1]))
    r = api.post(f"/api/games/{pid}/answers", json={"question_id": g["questions"][1]["id"], "option_id": wrong}).json()
    assert not r["correct"] and r["score"] == 1
    cur = api.get(f"/api/games/{pid}").json()  # persisted state survives a reload
    assert cur["progress"]["answered"] == 2 and cur["questions"][0]["text"] and cur["questions"][0]["answer"]["correct"]
    assert cur["questions"][2]["answer"] is None and cur["finished_at"] is None
    for q in cur["questions"][2:]:
        res = api.post(f"/api/games/{pid}/answers", json={"question_id": q["id"], "option_id": q["options"][0]["id"]}).json()
    assert res["finished"] and api.get(f"/api/games/{pid}").json()["finished_at"]


def test_answers_are_idempotent_first_answer_stands(api, song):
    g = new_game(api, song)
    q = g["questions"][0]
    right = find_correct(api, g, q)
    other = next(o["id"] for o in q["options"] if o["id"] != right)
    first = api.post(f"/api/games/{g['public_id']}/answers", json={"question_id": q["id"], "option_id": other}).json()
    second = api.post(f"/api/games/{g['public_id']}/answers", json={"question_id": q["id"], "option_id": right}).json()
    assert not first["correct"] and not second["correct"] and second["already_answered"] and second["score"] == 0


def test_answer_validation(api, song):
    g = new_game(api, song)
    q0, q1 = g["questions"][0], g["questions"][1]
    r = api.post(f"/api/games/{g['public_id']}/answers", json={"question_id": q0["id"], "option_id": q1["options"][0]["id"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_option"
    assert api.post(f"/api/games/{g['public_id']}/answers", json={"question_id": 9999, "option_id": 1}).status_code == 404
    assert api.get("/api/games/not-a-game").json()["error"]["code"] == "game_not_found"


def test_game_requires_lyrics_valid_difficulty_and_song(api, tmp_path):
    s = upload(api, make_wav(tmp_path / "No - Lyrics.wav", seed=5)).json()
    r = api.post("/api/games", json={"song_id": s["id"], "difficulty": "easy"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "no_lyrics"
    assert api.post("/api/games", json={"song_id": 999, "difficulty": "easy"}).status_code == 404


def test_invalid_difficulty(api, song):
    assert api.post("/api/games", json={"song_id": song["id"], "difficulty": "nightmare"}).json()["error"]["code"] == "invalid_difficulty"


def test_unsynchronized_game_is_free_play(api, tmp_path):
    api.put("/api/settings", json={**api.get("/api/settings").json(), "allow_unsynchronized_lyrics": True})
    s = upload(api, make_wav(tmp_path / "Plain - Song.wav", seed=9)).json()
    api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("p.txt", PLAIN.encode(), "text/plain")})
    g = new_game(api, s)
    assert g["synced"] is False
    assert all(q["audio_start"] is None and q["audio_end"] is None for q in g["questions"])


def test_offset_is_exposed_and_games_listed(api, song):
    api.patch(f"/api/songs/{song['id']}", json={"lyrics_offset": 0.7})
    g = new_game(api, song)
    assert g["lyrics_offset"] == 0.7
    assert api.get(f"/api/songs/{song['id']}/games").json()[0]["public_id"] == g["public_id"]


def test_unsupported_language(api, song):
    api.patch(f"/api/songs/{song['id']}", json={"language": "ja"})
    r = api.post("/api/games", json={"song_id": song["id"], "difficulty": "easy"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "language_not_supported"


def test_new_lyrics_do_not_break_old_games(api, song):
    g = new_game(api, song)
    api.post(f"/api/songs/{song['id']}/lyrics/upload", files={"file": ("l2.lrc", LRC.replace("Arbeit", "Schule").encode(), "text/plain")})
    old = api.get(f"/api/games/{g['public_id']}").json()
    assert len(old["questions"]) == len(g["questions"]) and old["questions"][0]["id"] == g["questions"][0]["id"]
    newer = new_game(api, song)
    assert newer["questions"][0]["id"] != g["questions"][0]["id"]


def test_recovery_start_is_previous_lyric_line(api, song):
    g = new_game(api, song)
    starts = [0.0, 5.0, 10.0, 15.0, 20.0, 25.0]  # one line every 5 s, see LRC
    for q in g["questions"]:
        i = starts.index(q["audio_start"])
        assert q["recovery_start"] == starts[max(i - 1, 0)]
    first = g["questions"][0]
    if first["audio_start"] == 0.0:
        assert first["recovery_start"] == 0.0


def test_four_difficulty_levels_through_the_api(api, song):
    counts = {d: len(new_game(api, song, d)["questions"]) for d in ("easy", "medium", "hard", "expert")}
    assert list(counts.values()) == sorted(counts.values()) and len(set(counts.values())) == 4, counts


def test_several_questions_on_one_line_share_a_sentence_and_timing(api, song):
    g = new_game(api, song, "expert")
    by_line = {}
    for q in g["questions"]:
        by_line.setdefault(q["line_id"], []).append(q)
    multi = [qs for qs in by_line.values() if len(qs) > 1]
    assert multi
    for qs in multi:
        assert [q["blank_index"] for q in qs] == list(range(len(qs)))
        assert len({q["question_text"] for q in qs}) == 1
        assert len({(q["audio_start"], q["audio_end"], q["recovery_start"]) for q in qs}) == 1
        assert qs[0]["question_text"].count("____") == len(qs)
    assert [q["sequence"] for q in g["questions"]] == list(range(len(g["questions"])))
