import pytest
from fastapi.testclient import TestClient

from app.db.models import User, UserSession
from app.main import app
from app.services.accounts import auth

from tests.test_api_games import LRC, make_wav, upload


def sign_up(api, name="anna", password="correct horse", **extra):
    return api.post("/api/auth/register", json={"username": name, "password": password, **extra})


def other_browser(api) -> TestClient:
    """A second client with its own cookie jar against the same app and database."""
    return TestClient(app)


# ---------- passwords ----------
def test_password_hash_roundtrip_and_format():
    h = auth.hash_password("secret pass")
    assert h.startswith("scrypt$") and "secret pass" not in h
    assert auth.verify_password("secret pass", h)
    assert not auth.verify_password("secret pasS", h)
    assert h != auth.hash_password("secret pass")  # salted
    assert not auth.verify_password("x", None) and not auth.verify_password("x", "garbage") and not auth.verify_password("x", "scrypt$1$2")


# ---------- guest ----------
def test_guest_is_the_default_identity(api):
    me = api.get("/api/auth/me").json()
    assert me["user"]["is_guest"] and me["user"]["display_name"] == "Guest" and me["allow_guest"] and me["first_account"]
    assert api.get("/api/songs").status_code == 200  # no sign-in needed


def test_guest_can_be_switched_off_by_the_administrator(api):
    sign_up(api, "boss")
    s = api.get("/api/settings").json()
    assert api.put("/api/settings", json={**s, "allow_guest": False}).status_code == 200
    anyone = other_browser(api)
    assert anyone.get("/api/auth/me").json()["user"] is None
    r = anyone.get("/api/songs")
    assert r.status_code == 401 and r.json()["error"]["code"] == "auth_required"
    assert anyone.get("/api/health").status_code == 200  # health stays public
    assert api.get("/api/songs").status_code == 200  # the signed-in browser keeps working


# ---------- register / login / logout ----------
def test_register_signs_in_and_first_account_is_admin(api):
    r = sign_up(api, "Anna", display_name="Anna K.")
    assert r.status_code == 201
    body = r.json()
    assert body["user"]["username"] == "anna" and body["user"]["display_name"] == "Anna K." and body["user"]["is_admin"]
    assert "chorus_session" in r.headers["set-cookie"] and "HttpOnly" in r.headers["set-cookie"] and "samesite=lax" in r.headers["set-cookie"].lower()
    assert api.get("/api/auth/me").json()["user"]["username"] == "anna"
    bob = other_browser(api)
    assert not bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"}).json()["user"]["is_admin"]


@pytest.mark.parametrize("name", ["ab", "guest", "GUEST", "has space", "-start", "x" * 40, "ünï"])
def test_bad_usernames(api, name):
    r = sign_up(api, name)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_username"


def test_weak_password_and_duplicate_name(api):
    assert sign_up(api, "anna", "short").json()["error"]["code"] == "weak_password"
    assert sign_up(api, "anna").status_code == 201
    r = other_browser(api).post("/api/auth/register", json={"username": "ANNA", "password": "another pass"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "username_taken"


def test_registration_can_be_closed_but_not_for_the_first_account(api, session):
    from app.services.settings import load_settings, save_settings

    save_settings(session, load_settings(session).model_copy(update={"allow_registration": False}))
    assert sign_up(api, "first").status_code == 201  # nobody exists yet, so there is someone to administer
    r = other_browser(api).post("/api/auth/register", json={"username": "late", "password": "another pass"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "registration_closed"
    s = api.get("/api/settings").json()
    assert api.put("/api/settings", json={**s, "allow_registration": True}).status_code == 200
    assert other_browser(api).post("/api/auth/register", json={"username": "late", "password": "another pass"}).status_code == 201


def test_login_logout_and_session_storage(api, session):
    sign_up(api, "anna")
    token = api.cookies.get("chorus_session")
    row = session.query(UserSession).one()
    assert row.token_hash != token and len(row.token_hash) == 64  # only a digest is stored
    api.post("/api/auth/logout")
    assert api.get("/api/auth/me").json()["user"]["is_guest"]
    assert session.query(UserSession).count() == 0
    bad = api.post("/api/auth/login", json={"username": "anna", "password": "nope nope"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "invalid_credentials"
    assert api.post("/api/auth/login", json={"username": "ANNA", "password": "correct horse"}).json()["user"]["username"] == "anna"
    assert api.get("/api/auth/me").json()["user"]["username"] == "anna"


def test_unknown_user_and_wrong_password_look_the_same(api):
    sign_up(api, "anna")
    a = api.post("/api/auth/login", json={"username": "anna", "password": "wrong wrong"}).json()
    b = api.post("/api/auth/login", json={"username": "nobody", "password": "wrong wrong"}).json()
    assert a == b


def test_expired_session_is_ignored_and_removed(api, session):
    from datetime import timedelta

    from app.db.models.types import utcnow

    sign_up(api, "anna")
    row = session.query(UserSession).one()
    row.expires_at = utcnow() - timedelta(seconds=1)
    session.commit()
    assert api.get("/api/auth/me").json()["user"]["is_guest"]
    assert session.query(UserSession).count() == 0


def test_login_is_throttled_after_repeated_failures(api):
    sign_up(api, "anna")
    for _ in range(auth.LoginThrottle.MAX_FAILURES):
        assert api.post("/api/auth/login", json={"username": "anna", "password": "wrong wrong"}).status_code == 401
    r = api.post("/api/auth/login", json={"username": "anna", "password": "correct horse"})  # even the right one waits
    assert r.status_code == 429 and r.json()["error"]["code"] == "too_many_attempts"


def test_throttle_clock():
    now = [0.0]
    t = auth.LoginThrottle(clock=lambda: now[0])
    for _ in range(5):
        t.failed("a", "1.1.1.1")
    with pytest.raises(Exception):
        t.check("a", "1.1.1.1")
    t.check("a", "2.2.2.2")  # another address is not affected
    now[0] = 61
    t.check("a", "1.1.1.1")  # the lock-out ended
    t.succeeded("a", "1.1.1.1")


def test_change_password_signs_out_other_devices(api):
    sign_up(api, "anna")
    other = other_browser(api)
    other.post("/api/auth/login", json={"username": "anna", "password": "correct horse"})
    assert api.post("/api/auth/password", json={"current_password": "wrong one", "new_password": "brand new pass"}).status_code == 401
    assert api.post("/api/auth/password", json={"current_password": "correct horse", "new_password": "brand new pass"}).status_code == 200
    assert api.get("/api/auth/me").json()["user"]["username"] == "anna"
    assert other.get("/api/auth/me").json()["user"]["is_guest"]
    assert other.post("/api/auth/login", json={"username": "anna", "password": "brand new pass"}).status_code == 200


# ---------- administration ----------
def test_only_the_administrator_manages_users_and_access(api, session):
    sign_up(api, "boss")
    bob = other_browser(api)
    bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"})
    assert bob.get("/api/users").status_code == 403
    s = bob.get("/api/settings").json()
    r = bob.put("/api/settings", json={**s, "allow_guest": False})
    assert r.status_code == 403 and r.json()["error"]["code"] == "admin_required"
    assert bob.put("/api/settings", json={**s, "default_language": "fr"}).status_code == 200  # other settings stay open to everyone
    users = api.get("/api/users").json()
    assert [u["username"] for u in users] == ["boss", "bob"]
    bob_id = users[1]["id"]
    assert api.delete(f"/api/users/{users[0]['id']}").status_code == 409  # not yourself
    assert api.delete(f"/api/users/{bob_id}").status_code == 200
    assert session.query(User).filter_by(username="bob").count() == 0
    assert bob.get("/api/auth/me").json()["user"]["is_guest"]  # their session went with them


# ---------- games belong to their player ----------
@pytest.fixture
def song(api, tmp_path):
    s = upload(api, make_wav(tmp_path / "Band - Lied.wav", seconds=40)).json()
    api.post(f"/api/songs/{s['id']}/lyrics/upload", files={"file": ("l.lrc", LRC.encode(), "text/plain")})
    return s


def test_games_are_private_to_their_player(api, song):
    sign_up(api, "anna")
    g = api.post("/api/games", json={"song_id": song["id"], "difficulty": "easy"}).json()
    pid = g["public_id"]
    assert [x["public_id"] for x in api.get(f"/api/songs/{song['id']}/games").json()] == [pid]
    assert [x["public_id"] for x in api.get("/api/games").json()] == [pid]

    bob = other_browser(api)
    bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"})
    q = g["questions"][0]
    assert bob.get(f"/api/games/{pid}").status_code == 404
    assert bob.post(f"/api/games/{pid}/answers", json={"question_id": q["id"], "option_id": q["options"][0]["id"]}).status_code == 404
    assert bob.get(f"/api/songs/{song['id']}/games").json() == [] and bob.get("/api/games").json() == []

    guest = other_browser(api)
    assert guest.get(f"/api/games/{pid}").status_code == 404
    assert guest.get(f"/api/songs/{song['id']}/games").json() == []
    api.post("/api/auth/logout")
    assert api.get(f"/api/games/{pid}").status_code == 404  # signing out hands the game back to nobody


def test_the_songs_and_lyrics_are_shared(api, song):
    sign_up(api, "anna")
    bob = other_browser(api)
    bob.post("/api/auth/register", json={"username": "bob", "password": "another pass"})
    assert [s["id"] for s in bob.get("/api/songs").json()] == [song["id"]]
    assert bob.get(f"/api/songs/{song['id']}/lyrics").status_code == 200
