"""Accounts: password hashing, sessions, the built-in Guest, login throttling.

No third-party dependency: scrypt and secrets come from the standard library. Only the SHA-256 of a session token is
stored, so a copy of the database does not contain usable cookies.
"""
import hashlib
import hmac
import re
import secrets
import time
from collections.abc import Callable
from datetime import timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import Game, User, UserSession
from app.db.models.types import utcnow
from app.db.models.user import GUEST_USERNAME

COOKIE = "chorus_session"
SESSION_DAYS = 30
MIN_PASSWORD = 8
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{2,31}$")
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}


# ---------- passwords ----------
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(candidate, bytes.fromhex(digest))


# ---------- users ----------
def ensure_guest(session: Session) -> User:
    guest = session.query(User).filter_by(username=GUEST_USERNAME).one_or_none()
    if guest is None:
        guest = User(username=GUEST_USERNAME, display_name="Guest", is_guest=True)
        session.add(guest)
        session.commit()
    return guest


def real_user_count(session: Session) -> int:
    return session.query(func.count(User.id)).filter(User.is_guest.is_(False)).scalar() or 0


def normalize_username(raw: str) -> str:
    name = raw.strip().lower()
    if not USERNAME_RE.match(name) or name == GUEST_USERNAME:
        raise AppError("invalid_username", "Use 3 to 32 letters, digits, dots, dashes or underscores (and not 'guest').", 422)
    return name


def check_password(password: str) -> None:
    if len(password) < MIN_PASSWORD:
        raise AppError("weak_password", f"Use at least {MIN_PASSWORD} characters for the password.", 422)
    if len(password) > 200:
        raise AppError("weak_password", "That password is too long.", 422)


def register(session: Session, username: str, password: str, display_name: str | None, allow_registration: bool) -> User:
    first = real_user_count(session) == 0
    if not first and not allow_registration:
        raise AppError("registration_closed", "New accounts are disabled on this server.", 403)
    name = normalize_username(username)
    check_password(password)
    if session.query(User).filter_by(username=name).first():
        raise AppError("username_taken", "That username is already taken.", 409)
    user = User(username=name, display_name=(display_name or username).strip()[:64] or name,
                password_hash=hash_password(password), is_admin=first)  # the first account administers the server
    session.add(user)
    session.commit()
    return user


# ---------- sessions ----------
def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(session: Session, user: User) -> str:
    token = secrets.token_urlsafe(32)
    session.add(UserSession(token_hash=_digest(token), user_id=user.id, expires_at=utcnow() + timedelta(days=SESSION_DAYS)))
    session.commit()
    return token


def user_for_token(session: Session, token: str | None) -> User | None:
    if not token:
        return None
    row = session.query(UserSession).filter_by(token_hash=_digest(token)).one_or_none()
    if row is None:
        return None
    now = utcnow()
    if row.expires_at <= now:
        session.delete(row)
        session.commit()
        return None
    if row.expires_at - now < timedelta(days=SESSION_DAYS - 1):  # sliding expiry, written at most once a day
        row.expires_at = now + timedelta(days=SESSION_DAYS)
        session.commit()
    return session.get(User, row.user_id)


def end_session(session: Session, token: str | None) -> None:
    if token:
        session.query(UserSession).filter_by(token_hash=_digest(token)).delete()
        session.commit()


def end_all_sessions(session: Session, user_id: int, keep_token: str | None = None) -> None:
    keep = _digest(keep_token) if keep_token else None
    q = session.query(UserSession).filter(UserSession.user_id == user_id)
    if keep:
        q = q.filter(UserSession.token_hash != keep)
    q.delete(synchronize_session=False)
    session.commit()


def delete_user(session: Session, user: User) -> None:
    for game in session.query(Game).filter_by(user_id=user.id).all():
        session.delete(game)  # answers go with it
    session.query(UserSession).filter_by(user_id=user.id).delete()
    session.delete(user)
    session.commit()


# ---------- login throttling ----------
class LoginThrottle:
    """After MAX_FAILURES wrong passwords for one username from one address, wait before trying again."""

    MAX_FAILURES = 5
    WINDOW = 300.0
    LOCKOUT = 60.0

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self._failures: dict[tuple[str, str], list[float]] = {}

    def _recent(self, key: tuple[str, str]) -> list[float]:
        now = self.clock()
        recent = [t for t in self._failures.get(key, []) if now - t < self.WINDOW]
        self._failures[key] = recent
        return recent

    def check(self, username: str, address: str) -> None:
        recent = self._recent((username, address))
        if len(recent) >= self.MAX_FAILURES and self.clock() - recent[-1] < self.LOCKOUT:
            wait = int(self.LOCKOUT - (self.clock() - recent[-1])) + 1
            raise AppError("too_many_attempts", f"Too many wrong passwords. Try again in {wait} seconds.", 429)

    def failed(self, username: str, address: str) -> None:
        self._recent((username, address)).append(self.clock())

    def succeeded(self, username: str, address: str) -> None:
        self._failures.pop((username, address), None)

    def reset(self) -> None:
        self._failures.clear()


throttle = LoginThrottle()


def login(session: Session, username: str, password: str, address: str) -> User:
    name = username.strip().lower()
    throttle.check(name, address)
    user = session.query(User).filter_by(username=name).one_or_none()
    ok = verify_password(password, user.password_hash if user else None)
    if not ok:
        if user is None:  # same work and same answer whether or not the name exists
            hash_password(password)
        throttle.failed(name, address)
        raise AppError("invalid_credentials", "Wrong username or password.", 401)
    throttle.succeeded(name, address)
    assert user is not None
    return user

