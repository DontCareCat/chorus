from functools import lru_cache

from fastapi import Depends, Request
from sqlalchemy.orm import Session, sessionmaker

from app.core.errors import AppError
from app.db.database import SessionLocal, get_session
from app.db.models import Song, User
from app.services.accounts import auth
from app.services.library.covers import CoverClient
from app.services.dictionary.lookup import Translator, Wiktionary
from app.services.lyrics.cache import CachedLrclib
from app.services.lyrics.lrclib import LrclibClient
from app.services.settings import RuntimeSettings, load_settings


@lru_cache
def _client() -> LrclibClient:
    return LrclibClient()


def get_lrclib_client() -> LrclibClient:  # overridden in tests
    return _client()


@lru_cache
def _cover_client() -> CoverClient:
    return CoverClient()


def get_cover_client() -> CoverClient:  # overridden in tests
    return _cover_client()


@lru_cache
def _translator() -> Translator:
    return Translator()


def get_translator() -> Translator:  # overridden in tests
    return _translator()


@lru_cache
def _wiktionary() -> Wiktionary:
    return Wiktionary()


def get_wiktionary() -> Wiktionary:  # overridden in tests
    return _wiktionary()


def get_session_factory() -> sessionmaker:  # overridden in tests (background tasks open their own session)
    return SessionLocal


def get_cfg(session: Session = Depends(get_session)) -> RuntimeSettings:
    return load_settings(session)


def get_lrclib(
    session: Session = Depends(get_session), client: LrclibClient = Depends(get_lrclib_client),
    cfg: RuntimeSettings = Depends(get_cfg),
) -> CachedLrclib:
    return CachedLrclib(client, session, cfg.lyrics_cache_ttl_days)


def get_song(song_id: int, session: Session = Depends(get_session)) -> Song:
    song = session.get(Song, song_id)
    if song is None or song.removed:
        raise AppError("song_not_found", "Song not found", 404)
    return song


def current_user(request: Request, session: Session = Depends(get_session), cfg: RuntimeSettings = Depends(get_cfg)) -> User:
    """The signed-in user, else the shared Guest (unless the administrator switched guests off)."""
    user = auth.user_for_token(session, request.cookies.get(auth.COOKIE))
    if user is not None:
        return user
    if cfg.allow_guest:
        return auth.ensure_guest(session)
    raise AppError("auth_required", "Sign in to use Chorus.", 401)


LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}


def is_local_request(request: Request) -> bool:
    """The request comes from the machine Chorus runs on (a reverse proxy in front makes it look local, so any
    forwarding header means 'not local')."""
    if request.headers.get("x-forwarded-for") or request.headers.get("forwarded"):
        return False
    return bool(request.client) and request.client.host in LOCAL_HOSTS


def path_access(request: Request, user: User = Depends(current_user)) -> User:
    """Browsing the server's folders and importing from a path are for the person at this machine and for the
    administrator. (PATH_ACCESS=open lifts it, for a trusted network or a container where every request looks remote.)"""
    from app.core.config import settings as env

    if env.path_access == "open" or user.is_admin or is_local_request(request):
        return user
    raise AppError("path_access_denied", "Only the administrator, or someone at the computer running Chorus, can browse folders or import by path.", 403)


def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise AppError("admin_required", "Only the administrator can do this.", 403)
    return user
