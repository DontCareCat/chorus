from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.errors import AppError
from app.db.database import get_session
from app.db.models import User
from app.services.settings import RuntimeSettings, load_settings, save_settings

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(current_user)])


MASK = "********"


def _masked(cfg: RuntimeSettings) -> RuntimeSettings:
    """The Spotify secret is write-only: the browser is told that one is set, never what it is."""
    return cfg.model_copy(update={"spotify_client_secret": MASK if cfg.spotify_client_secret else ""})


@router.get("", response_model=RuntimeSettings)
def read_settings(session: Session = Depends(get_session)):
    return _masked(load_settings(session))


@router.put("", response_model=RuntimeSettings)
def write_settings(new: RuntimeSettings, session: Session = Depends(get_session), user: User = Depends(current_user)):
    current = load_settings(session)
    if not user.is_admin and (new.allow_guest, new.allow_registration) != (current.allow_guest, current.allow_registration):
        raise AppError("admin_required", "Only the administrator can change who may use this server.", 403)
    if new.spotify_client_secret == MASK:  # unchanged
        new = new.model_copy(update={"spotify_client_secret": current.spotify_client_secret})
    if not user.is_admin and not user.is_guest and (new.spotify_client_id, new.spotify_client_secret) != (current.spotify_client_id, current.spotify_client_secret):
        raise AppError("admin_required", "Only the administrator can change the Spotify credentials.", 403)
    return _masked(save_settings(session, new))
