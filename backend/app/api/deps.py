from functools import lru_cache

from fastapi import Depends, Request
from sqlalchemy.orm import Session, sessionmaker

from app.core.errors import AppError
from app.db.database import SessionLocal, get_session
from app.db.models import Song, User
from app.services.accounts import auth
from app.services.lyrics.cache import CachedLrclib
from app.services.lyrics.lrclib import LrclibClient
from app.services.settings import RuntimeSettings, load_settings


@lru_cache
def _client() -> LrclibClient:
    return LrclibClient()


def get_lrclib_client() -> LrclibClient:  # overridden in tests
    return _client()


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


def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise AppError("admin_required", "Only the administrator can do this.", 403)
    return user
