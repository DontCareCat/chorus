from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.deps import get_cfg, path_access
from app.core.errors import AppError
from app.services.library import fs
from app.services.settings import RuntimeSettings

router = APIRouter(prefix="/api/fs", tags=["files"], dependencies=[Depends(path_access)])


class EntryOut(BaseModel):
    name: str
    kind: str  # dir | audio
    size: int | None
    link: bool


class RootOut(BaseModel):
    name: str
    path: str


class ListingOut(BaseModel):
    path: str
    parent: str | None
    entries: list[EntryOut]
    roots: list[RootOut]


@router.get("/list", response_model=ListingOut)
def list_folder(path: str | None = None, hidden: bool = False, cfg: RuntimeSettings = Depends(get_cfg)):
    """Folders and audio files of one folder (names and sizes only). No `path`: the home folder."""
    target = Path(path).expanduser() if path else Path.home()
    if not target.is_absolute():
        raise AppError("invalid_path", "Use a full path such as /Users/you/Music or C:\\Music", 400)
    target = target.resolve()
    entries = fs.list_dir(target, hidden)
    parent = None if target.parent == target else str(target.parent)
    return ListingOut(
        path=str(target), parent=parent, entries=[EntryOut(name=e.name, kind=e.kind, size=e.size, link=e.link) for e in entries],
        roots=[RootOut(**r) for r in fs.roots(cfg.library_dirs)],
    )
