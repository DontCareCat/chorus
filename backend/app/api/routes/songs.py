import mimetypes
import shutil
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_cfg, get_lrclib_client, get_session_factory, get_song
from app.core.config import settings as env
from app.core.errors import AppError
from app.db.database import get_session
from app.db.models import Song, SongSource
from app.schemas.song import ImportRequest, ImportTreeRequest, ScanOut, SongOut, SongPatch
from app.services.library.scanner import import_tree, register_song, remove_song, scan_library
from app.services.library.storage import check_extension, save_upload
from app.services.library.tags import extract_cover
from app.services.lyrics.background import discover_for_songs
from app.services.lyrics.lrclib import LrclibClient
from app.services.settings import RuntimeSettings

router = APIRouter(prefix="/api", tags=["songs"])


@router.get("/songs", response_model=list[SongOut])
def list_songs(session: Session = Depends(get_session)):
    return list(session.scalars(select(Song).where(Song.removed.is_(False)).order_by(Song.artist, Song.title)))


@router.post("/songs", response_model=SongOut, status_code=201)
def upload_song(
    file: UploadFile, background: BackgroundTasks, session: Session = Depends(get_session),
    cfg: RuntimeSettings = Depends(get_cfg), factory: sessionmaker = Depends(get_session_factory),
    client: LrclibClient = Depends(get_lrclib_client),
):
    tmp, digest = save_upload(file.file, file.filename or "", env.max_upload_mb * 1024 * 1024)
    try:
        song, created = register_song(
            session, tmp, SongSource.upload,
            cfg.default_language, Path(env.media_dir), digest,
        )
    finally:
        shutil.rmtree(tmp.parent, ignore_errors=True)
    if created:
        background.add_task(discover_for_songs, factory, client, [song.id])
    return song


@router.post("/songs/import", response_model=SongOut, status_code=201)
def import_song(
    body: ImportRequest, background: BackgroundTasks, session: Session = Depends(get_session),
    cfg: RuntimeSettings = Depends(get_cfg), factory: sessionmaker = Depends(get_session_factory),
    client: LrclibClient = Depends(get_lrclib_client),
):
    path = Path(body.path).expanduser()
    if not path.is_absolute() or not path.is_file():
        raise AppError("invalid_path", "Path must be an absolute path to an existing file", 400)
    check_extension(path.name)
    song, created = register_song(session, path, SongSource.import_, cfg.default_language, Path(env.media_dir))
    if created:
        background.add_task(discover_for_songs, factory, client, [song.id])
    return song


@router.post("/library/import", response_model=ScanOut)
def import_path(
    body: ImportTreeRequest, background: BackgroundTasks, session: Session = Depends(get_session),
    cfg: RuntimeSettings = Depends(get_cfg), factory: sessionmaker = Depends(get_session_factory),
    client: LrclibClient = Depends(get_lrclib_client),
):
    """Import one audio file or a whole folder (optionally with its subfolders)."""
    path = Path(body.path).expanduser()
    if not path.is_absolute() or not (path.is_file() or path.is_dir()):
        raise AppError("invalid_path", "Path must be an absolute path to an existing file or folder", 400)
    if path.is_file():
        check_extension(path.name)
    result = import_tree(session, path, body.recursive, body.copy_files, cfg.default_language, Path(env.media_dir))
    if result.new_song_ids:
        background.add_task(discover_for_songs, factory, client, result.new_song_ids)
    return ScanOut(added=result.added, skipped=result.skipped, unavailable=0, errors=result.errors)


@router.post("/library/scan", response_model=ScanOut)
def scan(
    background: BackgroundTasks, session: Session = Depends(get_session),
    cfg: RuntimeSettings = Depends(get_cfg), factory: sessionmaker = Depends(get_session_factory),
    client: LrclibClient = Depends(get_lrclib_client),
):
    result = scan_library(session, cfg.library_dirs, cfg.default_language)
    if result.new_song_ids:
        background.add_task(discover_for_songs, factory, client, result.new_song_ids)
    return ScanOut(**{k: getattr(result, k) for k in ("added", "skipped", "unavailable", "errors")})


@router.patch("/songs/{song_id}", response_model=SongOut)
def patch_song(body: SongPatch, song: Song = Depends(get_song), session: Session = Depends(get_session)):
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is not None or key == "album":
            setattr(song, key, value)
    session.commit()
    return song


@router.delete("/songs/{song_id}")
def delete_song(song: Song = Depends(get_song), session: Session = Depends(get_session)):
    """Remove from the library. Songs used in place are only hidden; uploaded/imported copies are deleted."""
    return {"result": remove_song(session, song, Path(env.media_dir))}


@router.get("/songs/{song_id}/cover")
def cover(song: Song = Depends(get_song), session: Session = Depends(get_session)):
    """Embedded album art, if the audio file has any."""
    found = extract_cover(Path(song.file_path)) if Path(song.file_path).is_file() and song.has_cover is not False else None
    if song.has_cover != (found is not None):
        song.has_cover = found is not None
        session.commit()
    if found is None:
        raise AppError("no_cover", "This song has no embedded cover art", 404)
    data, mime = found
    return Response(content=data, media_type=mime, headers={"Cache-Control": "public, max-age=86400"})


@router.get("/songs/{song_id}/audio")
def stream_audio(song: Song = Depends(get_song)):
    path = Path(song.file_path)
    if not path.is_file():
        raise AppError("file_missing", "The audio file is no longer available", 404)
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type)  # Starlette handles HTTP Range
