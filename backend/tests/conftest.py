import os
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import models  # noqa: F401
from app.db.database import Base

# In-memory SQLite by default; set TEST_DATABASE_URL to run the suite against MySQL.
TEST_URL = os.environ.get("TEST_DATABASE_URL", "sqlite://")


@pytest.fixture
def session() -> Iterator[Session]:
    if TEST_URL.startswith("sqlite"):
        engine = create_engine(TEST_URL, poolclass=StaticPool, connect_args={"check_same_thread": False})
        event.listen(engine, "connect", lambda c, _: c.execute("PRAGMA foreign_keys=ON"))
    else:
        engine = create_engine(TEST_URL)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, expire_on_commit=False)() as s:
        yield s
    Base.metadata.drop_all(engine)


# ---------- API-level fixtures ----------
import json
import wave
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from app.api.deps import get_lrclib_client, get_session_factory
from app.core.config import settings as env
from app.db.database import get_session
from app.main import app
from app.services.lyrics.lrclib import LrclibClient


def make_wav(path: Path, seconds: float = 2.0, seed: int = 0) -> Path:
    """Tiny valid WAV; `seed` makes the bytes (hence the hash) unique."""
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"".join((seed + i % 7).to_bytes(2, "little") for i in range(int(8000 * seconds))))
    return path


def lrclib_json(id=1, artist="Rammstein", title="Du hast", duration=2.0, synced="[00:00.50] Du hast\n[00:01.20] mich gefragt",
                plain="Du hast\nmich gefragt", instrumental=False):
    return {"id": id, "artistName": artist, "trackName": title, "albumName": "A", "duration": duration,
            "instrumental": instrumental, "syncedLyrics": synced, "plainLyrics": plain}


class FakeLrclib:
    """Controllable LRCLIB server behind httpx.MockTransport."""

    def __init__(self):
        self.get_result: dict | None = None
        self.search_result: list[dict] = []
        self.by_id: dict[int, dict] = {}
        self.status: int | None = None  # force an HTTP status
        self.calls: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request.url.path)
        if self.status:
            return httpx.Response(self.status)
        path = request.url.path
        if path.endswith("/search"):
            return httpx.Response(200, json=self.search_result)
        if "/get/" in path:
            j = self.by_id.get(int(path.rsplit("/", 1)[1]))
            return httpx.Response(200, json=j) if j else httpx.Response(404)
        return httpx.Response(200, json=self.get_result) if self.get_result else httpx.Response(404)

    def client(self) -> LrclibClient:
        http = httpx.Client(transport=httpx.MockTransport(self.handler), base_url="https://lrclib.test/api")
        return LrclibClient(http, retries=3, backoff=0, sleep=lambda _: None)


@pytest.fixture
def lrclib() -> FakeLrclib:
    return FakeLrclib()


@pytest.fixture
def api(session, lrclib, tmp_path, monkeypatch) -> Iterator[TestClient]:
    monkeypatch.setattr(env, "media_dir", str(tmp_path / "media"))
    monkeypatch.setattr(env, "library_dirs", "")
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    client = lrclib.client()
    def _get_session():
        with factory() as s:
            yield s

    app.dependency_overrides[get_session] = _get_session
    app.dependency_overrides[get_session_factory] = lambda: factory
    app.dependency_overrides[get_lrclib_client] = lambda: client
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()



@pytest.fixture(autouse=True)
def _fresh_login_throttle():
    from app.services.accounts import auth

    auth.throttle.reset()
    yield
    auth.throttle.reset()
