from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.database import get_session
from app.services.settings import RuntimeSettings, load_settings, save_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=RuntimeSettings)
def read_settings(session: Session = Depends(get_session)):
    return load_settings(session)


@router.put("", response_model=RuntimeSettings)
def write_settings(new: RuntimeSettings, session: Session = Depends(get_session)):
    return save_settings(session, new)
