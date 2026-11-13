import httpx

from app.api.routes.settings import check_service
from app.services.lyrics.lrclib import LrclibClient, LrclibUnavailable
from app.services.settings import normalize_service_url
from tests.test_accounts import other_browser, sign_up


def test_normalize_service_url():
    assert normalize_service_url("") == ""
    assert normalize_service_url("  lrclib.example.org ") == "https://lrclib.example.org/api"
    assert normalize_service_url("https://x.test/api/") == "https://x.test/api"
    assert normalize_service_url("http://x.test:3300") == "http://x.test:3300/api"
    assert normalize_service_url("https://x.test/v1/lrclib") == "https://x.test/v1/lrclib"


def test_no_lyrics_service_by_default(api):
    sign_up(api, "anna")
    assert api.get("/api/settings").json()["lyrics_service_url"] == ""  # the startup window asks the administrator to choose one


def test_the_environment_value_is_the_default_and_the_admin_can_change_it(api, monkeypatch):
    monkeypatch.setattr("app.services.settings.env.lrclib_base_url", "https://lyrics.example.org/api")
    sign_up(api, "anna")  # the first account is the administrator
    s = api.get("/api/settings").json()
    assert s["lyrics_service_url"] == "https://lyrics.example.org/api"
    r = api.put("/api/settings", json={**s, "lyrics_service_url": "my.server.test"})
    assert r.status_code == 200 and r.json()["lyrics_service_url"] == "https://my.server.test/api"
    assert api.get("/api/settings").json()["lyrics_service_url"] == "https://my.server.test/api"
    cleared = api.put("/api/settings", json={**s, "lyrics_service_url": ""}).json()
    assert cleared["lyrics_service_url"] == ""


def test_other_people_can_read_it_but_not_change_it(api):
    sign_up(api, "anna")
    s = api.get("/api/settings").json()
    api.put("/api/settings", json={**s, "lyrics_service_url": "https://admin.test/api"})
    bob = other_browser(api)
    bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"})
    seen = bob.get("/api/settings").json()
    assert seen["lyrics_service_url"] == "https://admin.test/api"
    assert bob.put("/api/settings", json={**seen, "default_language": "fr"}).status_code == 200  # other settings stay open
    r = bob.put("/api/settings", json={**seen, "lyrics_service_url": "https://evil.test/api"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "admin_required"
    assert bob.post("/api/settings/lyrics-service/check", json={"url": "https://x.test/api"}).status_code == 403
    assert api.get("/api/settings").json()["lyrics_service_url"] == "https://admin.test/api"


def test_an_address_without_http_is_refused(api):
    sign_up(api, "anna")
    s = api.get("/api/settings").json()
    assert api.put("/api/settings", json={**s, "lyrics_service_url": "ftp://x.test/api"}).status_code == 422


def test_empty_address_means_no_lookups():
    client = LrclibClient(base_url="")
    try:
        client.search("x")
        raise AssertionError("expected LrclibUnavailable")
    except LrclibUnavailable as e:
        assert "No lyrics service" in str(e)


def _http(handler):
    return httpx.Client(transport=httpx.MockTransport(handler), base_url="https://x.test/api")


def test_check_accepts_a_service_that_answers_like_lrclib():
    ok = check_service("https://x.test/api", _http(lambda r: httpx.Response(404, json={"code": 404}) if r.url.path.endswith("/get") else httpx.Response(200, json=[])))
    assert ok["ok"] is True


def test_check_rejects_a_web_page_and_says_what_it_got():
    bad = check_service("https://x.test/api", _http(lambda r: httpx.Response(404, text="<html>nope</html>")))
    assert bad["ok"] is False and "HTTP 404" in bad["message"] and "/api" in bad["message"]


def test_check_endpoint_for_the_admin(api, monkeypatch):
    sign_up(api, "anna")
    import app.api.routes.settings as route
    monkeypatch.setattr(route, "check_service", lambda url: {"ok": True, "message": f"checked {url}"})
    r = api.post("/api/settings/lyrics-service/check", json={"url": "https://x.test/api"})
    assert r.status_code == 200 and r.json() == {"ok": True, "message": "checked https://x.test/api"}
    assert check_service("")["ok"] is False


def test_an_older_client_that_does_not_send_the_address_leaves_it_alone(api):
    sign_up(api, "anna")
    s = api.get("/api/settings").json()
    api.put("/api/settings", json={**s, "lyrics_service_url": "https://admin.test/api"})
    assert api.put("/api/settings", json={"default_language": "fr"}).status_code == 200
    assert api.get("/api/settings").json()["lyrics_service_url"] == "https://admin.test/api"
