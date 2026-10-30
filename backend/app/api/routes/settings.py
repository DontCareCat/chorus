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
    """The YouTube API key is write-only: the browser is told that one is saved, never what it is."""
    return cfg.model_copy(update={"youtube_api_key": MASK if cfg.youtube_api_key else ""})


@router.get("", response_model=RuntimeSettings)
def read_settings(session: Session = Depends(get_session)):
    return _masked(load_settings(session))


@router.put("", response_model=RuntimeSettings)
def write_settings(new: RuntimeSettings, session: Session = Depends(get_session), user: User = Depends(current_user)):
    current = load_settings(session)
    if not user.is_admin and (new.allow_guest, new.allow_registration) != (current.allow_guest, current.allow_registration):
        raise AppError("admin_required", "Only the administrator can change who may use this server.", 403)
    if new.youtube_api_key == MASK:  # unchanged
        new = new.model_copy(update={"youtube_api_key": current.youtube_api_key})
    if not user.is_admin and not user.is_guest and new.youtube_api_key != current.youtube_api_key:
        raise AppError("admin_required", "Only the administrator can change the YouTube API key.", 403)
    return _masked(save_settings(session, new))
