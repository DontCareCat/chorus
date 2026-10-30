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
    default_queue_difficulty: str = Field("progressive", pattern="^(progressive|easy|medium|hard|expert)$")  # difficulty of songs in the play queue
    queue_autoplay: bool = True  # a finished game from the play queue starts the next song by itself
    queue_fade: bool = False  # fade between songs: one fades out while the next fades in
    queue_fade_seconds: int = Field(4, ge=1, le=12)  # how long that fade lasts
    lyrics_timeout_minutes: int = Field(10, ge=1, le=1440)  # a song still searching for lyrics after this long gets a warning
    auto_pick_closest: bool = False  # when several lyrics could fit, take the one whose length is closest to the song's (instead of asking)
    auto_detect_language: bool = True  # set a new song's language from its lyrics
    auto_fetch_covers: bool = True  # look up missing album covers online (artist and album are sent to MusicBrainz)
    translation_enabled: bool = True  # dictionary: look up translations and articles online (the words and sentences are sent to the translation service and Wiktionary)
    youtube_enabled: bool = True  # YouTube songs: add them and play them in YouTube's own player (the video id and titles are looked up at YouTube)
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
