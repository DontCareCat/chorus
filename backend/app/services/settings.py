import json

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings as env
from app.db.models import AppSetting


class RuntimeSettings(BaseModel):
    allow_unsynchronized_lyrics: bool = False
    lyrics_cache_ttl_days: int = Field(30, ge=0)  # 0 = keep forever
    auto_fetch_lyrics: bool = True
    default_language: str = Field("de", min_length=2, max_length=16)
    library_dirs: list[str] = Field(default_factory=list)
    allow_guest: bool = True  # administrator only: may people use Chorus without signing in
    allow_registration: bool = True  # administrator only: may new accounts be created


def _defaults() -> RuntimeSettings:
    dirs = [d.strip() for d in env.library_dirs.split(",") if d.strip()]
    return RuntimeSettings(library_dirs=dirs)


def load_settings(session: Session) -> RuntimeSettings:
    values = _defaults().model_dump()
    for row in session.query(AppSetting).all():
        if row.key in values:
            values[row.key] = json.loads(row.value)
    return RuntimeSettings(**values)


def save_settings(session: Session, new: RuntimeSettings) -> RuntimeSettings:
    for key, value in new.model_dump().items():
        row = session.get(AppSetting, key)
        if row is None:
            session.add(AppSetting(key=key, value=json.dumps(value)))
        else:
            row.value = json.dumps(value)
    session.commit()
    return load_settings(session)
