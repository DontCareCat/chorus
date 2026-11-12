from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.errors import AppError
from app.db.database import get_session
from app.db.models import User
import httpx
from pydantic import BaseModel

from app.services.settings import RuntimeSettings, load_settings, normalize_service_url, save_settings
from app.services.lyrics.lrclib import USER_AGENT

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(current_user)])


@router.get("", response_model=RuntimeSettings)
def read_settings(session: Session = Depends(get_session)):
    return load_settings(session)


@router.put("", response_model=RuntimeSettings)
def write_settings(new: RuntimeSettings, session: Session = Depends(get_session), user: User = Depends(current_user)):
    current = load_settings(session)
    if not user.is_admin and (new.allow_guest, new.allow_registration) != (current.allow_guest, current.allow_registration):
        raise AppError("admin_required", "Only the administrator can change who may use this server.", 403)
    if "lyrics_service_url" not in new.model_fields_set:  # an older client that does not send it leaves it as it is
        new.lyrics_service_url = current.lyrics_service_url
    new.lyrics_service_url = normalize_service_url(new.lyrics_service_url)
    if not user.is_admin and new.lyrics_service_url != current.lyrics_service_url:
        raise AppError("admin_required", "Only the administrator can change the lyrics service.", 403)
    if new.lyrics_service_url and not new.lyrics_service_url.lower().startswith(("http://", "https://")):
        raise AppError("bad_url", "The lyrics service address must start with http:// or https://", 422)
    return save_settings(session, new)


class ServiceCheckIn(BaseModel):
    url: str = ""


def check_service(url: str, http: httpx.Client | None = None) -> dict:
    """Ask the service what the app asks it: a lookup of a track that does not exist (a working service says 404) and a search."""
    url = normalize_service_url(url)
    if not url:
        return {"ok": False, "message": "Enter the address of a lyrics service first."}
    if not url.lower().startswith(("http://", "https://")):
        return {"ok": False, "message": "The address must start with http:// or https://"}
    client = http or httpx.Client(base_url=url, headers={"User-Agent": USER_AGENT}, timeout=10)
    tried: list[str] = []
    for path, params, good in (
        ("/get", {"artist_name": "Chorus", "track_name": "Chorus check", "duration": 100}, lambda r, b: r.status_code in (200, 404) and isinstance(b, dict)),
        ("/search", {"q": "Chorus"}, lambda r, b: r.status_code == 200 and isinstance(b, list)),
    ):
        try:
            r = client.get(path, params=params)
            try:
                body = r.json()
            except ValueError:
                body = None
            if good(r, body):
                return {"ok": True, "message": "The lyrics service answers."}
            tried.append(f"{path}: HTTP {r.status_code}" if r.status_code != 200 else f"{path}: an answer that is not LRCLIB's")
        except httpx.HTTPError as e:
            tried.append(f"{path}: {e}")
    hint = " Check the address; LRCLIB-compatible services usually end with /api." if all("HTTP 404" in t for t in tried) else ""
    return {"ok": False, "message": f"The service did not answer like LRCLIB ({'; '.join(tried)}).{hint}"}


@router.post("/lyrics-service/check")
def check_lyrics_service(body: ServiceCheckIn, user: User = Depends(current_user)):
    if not user.is_admin:
        raise AppError("admin_required", "Only the administrator can change the lyrics service.", 403)
    return check_service(body.url)
