"""Select mode on the Dictionary page: one action on the ticked words, or on every word the filters show."""
from tests.test_accounts import other_browser
from tests.test_dictionary import ask, entries, start, song  # noqa: F401  (song is a fixture)


def _words(api, song, n=None):
    g = start(api, song, difficulty="expert")
    for q in g["questions"][:n]:
        ask(api, g, q)
    return entries(api)["items"]


def _bulk(client, **body):
    r = client.post("/api/dictionary/bulk", json=body)
    assert r.status_code == 200, r.text
    return r.json()["changed"]


def test_pause_and_resume_the_ticked_words(api, song):
    a, b, *_ = _words(api, song)
    assert _bulk(api, action="pause", ids=[a["id"], b["id"]]) == 2
    assert {e["id"] for e in entries(api, status="suspended")["items"]} == {a["id"], b["id"]}
    assert _bulk(api, action="resume", ids=[a["id"]]) == 1
    assert [e["id"] for e in entries(api, status="suspended")["items"]] == [b["id"]]


def test_delete_with_a_filter_takes_only_what_the_filter_shows(api, song):
    words = _words(api, song)
    paused = words[0]
    _bulk(api, action="pause", ids=[paused["id"]])
    assert _bulk(api, action="delete", filter={"status": "new"}) == len(words) - 1
    assert [e["id"] for e in entries(api)["items"]] == [paused["id"]]


def test_a_search_filter_limits_the_action(api, song):
    words = _words(api, song)
    target = words[0]["surface"]
    shown = entries(api, q=target)["total"]
    assert 1 <= shown < len(words)
    assert _bulk(api, action="pause", filter={"status": "all", "q": target}) == shown
    assert entries(api, status="suspended")["total"] == shown
    assert _bulk(api, action="pause", filter={"language": "fr"}) == 0


def test_reset_progress_makes_reviewed_words_new_again(api, song):
    words = _words(api, song)
    first = api.get("/api/dictionary/review/next").json()["card"]
    assert api.post(f"/api/dictionary/review/{first['id']}/answer", json={"rating": "good"}).status_code == 200
    reviewed = api.get(f"/api/dictionary/{first['id']}").json()
    assert reviewed["reps"] == 1 and reviewed["due_at"] is not None
    assert _bulk(api, action="reset", ids=[first["id"]]) == 1
    after = api.get(f"/api/dictionary/{first['id']}").json()
    assert (after["reps"], after["lapses"], after["interval_seconds"], after["due_at"]) == (0, 0, 0, None)
    assert entries(api, status="new")["total"] == len(words)


def test_another_users_words_are_never_touched(api, song):
    words = _words(api, song)
    bob = other_browser(api)
    assert bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"}).status_code == 201
    assert _bulk(bob, action="delete", ids=[w["id"] for w in words]) == 0
    assert _bulk(bob, action="delete", filter={"status": "all"}) == 0
    assert entries(api)["total"] == len(words)


def test_nothing_selected_is_refused_and_an_empty_list_changes_nothing(api, song):
    words = _words(api, song)
    assert api.post("/api/dictionary/bulk", json={"action": "delete"}).status_code == 422
    assert api.post("/api/dictionary/bulk", json={"action": "explode", "ids": [words[0]["id"]]}).status_code == 422
    assert _bulk(api, action="delete", ids=[]) == 0
    assert entries(api)["total"] == len(words)


def test_select_all_minus_the_unticked_words(api, song):
    words = _words(api, song)
    keep = [words[0]["id"], words[-1]["id"]]
    assert _bulk(api, action="delete", filter={"status": "all"}, exclude=keep) == len(words) - 2
    assert sorted(e["id"] for e in entries(api)["items"]) == sorted(keep)
