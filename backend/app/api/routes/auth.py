from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import admin_user, current_user, get_cfg
from app.core.errors import AppError
from app.db.database import get_session
from app.db.models import User
from app.schemas.auth import AuthState, Credentials, PasswordChange, RegisterIn, UserOut
from app.services.accounts import auth
from app.services.settings import RuntimeSettings

router = APIRouter(prefix="/api", tags=["accounts"])


def _address(request: Request) -> str:
    return request.client.host if request.client else "?"


def _set_cookie(request: Request, response: Response, token: str) -> None:
    response.set_cookie(
        auth.COOKIE, token, max_age=auth.SESSION_DAYS * 86400, httponly=True, samesite="lax",
        secure=request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https", path="/",
    )


def _state(session: Session, cfg: RuntimeSettings, user: User | None) -> AuthState:
    return AuthState(
        user=UserOut.model_validate(user) if user else None, allow_registration=cfg.allow_registration,
        allow_guest=cfg.allow_guest, first_account=auth.real_user_count(session) == 0,
    )


@router.get("/auth/me", response_model=AuthState)
def me(request: Request, session: Session = Depends(get_session), cfg: RuntimeSettings = Depends(get_cfg)):
    user = auth.user_for_token(session, request.cookies.get(auth.COOKIE))
    if user is None and cfg.allow_guest:
        user = auth.ensure_guest(session)
    return _state(session, cfg, user)


@router.post("/auth/register", response_model=AuthState, status_code=201)
def register(body: RegisterIn, request: Request, response: Response, session: Session = Depends(get_session),
             cfg: RuntimeSettings = Depends(get_cfg)):
    user = auth.register(session, body.username, body.password, body.display_name, cfg.allow_registration)
    _set_cookie(request, response, auth.start_session(session, user))
    return _state(session, cfg, user)


@router.post("/auth/login", response_model=AuthState)
def login(body: Credentials, request: Request, response: Response, session: Session = Depends(get_session),
          cfg: RuntimeSettings = Depends(get_cfg)):
    user = auth.login(session, body.username, body.password, _address(request))
    _set_cookie(request, response, auth.start_session(session, user))
    return _state(session, cfg, user)


@router.post("/auth/logout", response_model=AuthState)
def logout(request: Request, response: Response, session: Session = Depends(get_session), cfg: RuntimeSettings = Depends(get_cfg)):
    auth.end_session(session, request.cookies.get(auth.COOKIE))
    response.delete_cookie(auth.COOKIE, path="/")
    return _state(session, cfg, auth.ensure_guest(session) if cfg.allow_guest else None)


@router.post("/auth/password")
def change_password(body: PasswordChange, request: Request, user: User = Depends(current_user),
                    session: Session = Depends(get_session)):
    if user.is_guest or not auth.verify_password(body.current_password, user.password_hash):
        raise AppError("invalid_credentials", "The current password is wrong.", 401)
    auth.check_password(body.new_password)
    user.password_hash = auth.hash_password(body.new_password)
    session.commit()
    auth.end_all_sessions(session, user.id, keep_token=request.cookies.get(auth.COOKIE))  # sign out other devices
    return {"ok": True}


@router.get("/users", response_model=list[UserOut])
def list_users(_: User = Depends(admin_user), session: Session = Depends(get_session)):
    return session.query(User).filter(User.is_guest.is_(False)).order_by(User.id).all()


@router.delete("/users/{user_id}")
def remove_user(user_id: int, admin: User = Depends(admin_user), session: Session = Depends(get_session)):
    user = session.get(User, user_id)
    if user is None or user.is_guest:
        raise AppError("user_not_found", "User not found", 404)
    if user.id == admin.id:
        raise AppError("cannot_delete_self", "You cannot delete your own account.", 409)
    auth.delete_user(session, user)
    return {"deleted": 1}
