import logging

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(api) -> TestClient:
    return api


def err(r):
    body = r.json()
    assert set(body) == {"error"} and set(body["error"]) == {"code", "message"}, body
    return body["error"]


def test_validation_errors_use_the_common_shape_with_a_useful_message(client):
    r = client.post("/api/games", json={"song_id": "x"})
    assert r.status_code == 422
    e = err(r)
    assert e["code"] == "invalid_request" and e["message"].startswith("song_id:")


def test_settings_validation_message_names_the_field(client):
    r = client.put("/api/settings", json={**client.get("/api/settings").json(), "lyrics_cache_ttl_days": -1})
    assert r.status_code == 422 and "lyrics_cache_ttl_days" in err(r)["message"]


def test_unknown_path_and_wrong_method_are_structured(client):
    assert err(client.get("/api/nope")) == {"code": "http_404", "message": "Not found"}
    r = client.put("/api/songs")
    assert r.status_code == 405 and err(r)["code"] == "http_405"


def test_missing_body_is_reported(client):
    r = client.post("/api/games")
    assert r.status_code == 422 and err(r)["code"] == "invalid_request"


def test_unexpected_errors_are_logged_but_never_leak_internals(caplog):
    app = create_app()

    @app.get("/api/boom")
    def boom():
        raise RuntimeError("secret database password is hunter2")

    with caplog.at_level(logging.ERROR):
        r = TestClient(app, raise_server_exceptions=False).get("/api/boom")
    assert r.status_code == 500
    assert err(r)["code"] == "internal_error"
    assert "hunter2" not in r.text and "Traceback" not in r.text
    assert "hunter2" in caplog.text  # …but it is in the server log, with the traceback


def test_frontend_is_served_when_a_build_exists_and_the_api_still_wins(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>Chorus</title>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    c = TestClient(create_app(str(tmp_path)))
    assert "<title>Chorus</title>" in c.get("/").text
    assert c.get("/assets/app.js").text == "console.log(1)"
    assert c.get("/api/health").json()["status"] == "ok"  # not shadowed by the static mount
    assert err(c.get("/api/nope"))["code"] == "http_404"
    assert c.get("/missing.png").status_code == 404


def test_no_frontend_mount_without_a_build(tmp_path):
    c = TestClient(create_app(str(tmp_path)))  # an empty folder: no index.html
    assert c.get("/").status_code == 404
    assert c.get("/api/health").status_code == 200
    assert TestClient(create_app("")).get("/").status_code == 404
