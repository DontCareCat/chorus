import mimetypes
import shutil
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import current_user, get_cfg, get_cover_client, get_lrclib_client, get_session_factory, get_song, path_access
from app.core.config import settings as env
from app.core.errors import AppError
from app.db.database import get_session
from app.db.models import Lyrics, Song, SongSource
from app.schemas.song import BulkDeleteOut, BulkDeleteRequest, ImportManyRequest, ImportRequest, ImportTreeRequest, ScanOut, SongOut, SongPatch
from app.services.library.fs import name_filter
from app.services.library.scanner import import_tree, register_song, remove_song, scan_library
from app.services.library.storage import check_extension, save_upload
from app.services.library.covers import (
    CoverClient, CoverUnavailable, fetch_covers_for_songs, find_cover, remove_cover, store_cover, stored_cover, validate_image,
)
from app.services.library.tags import extract_cover
from app.services.lyrics.background import discover_for_songs
from app.services.lyrics.language import detect_language
from app.services.lyrics.lrclib import LrclibClient
from app.services.settings import RuntimeSettings

router = APIRouter(prefix="/api", tags=["songs"], dependencies=[Depends(current_user)])


@router.get("/songs", response_model=list[SongOut])
def list_songs(session: Session = Depends(get_session)):
    return list(session.scalars(select(Song).where(Song.removed.is_(False)).order_by(Song.artist, Song.title)))


@router.post("/songs", response_model=SongOut, status_code=201)
def upload_song(
    file: UploadFile, background: BackgroundTasks, session: Session = Depends(get_session),
    cfg: RuntimeSettings = Depends(get_cfg), factory: sessionmaker = Depends(get_session_factory),
    client: LrclibClient = Depends(get_lrclib_client), covers: CoverClient = Depends(get_cover_client),
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
        background.add_task(fetch_covers_for_songs, factory, covers, [song.id])
    return song


@router.post("/songs/import", response_model=SongOut, status_code=201, dependencies=[Depends(path_access)])
def import_song(
    body: ImportRequest, background: BackgroundTasks, session: Session = Depends(get_session),
    cfg: RuntimeSettings = Depends(get_cfg), factory: sessionmaker = Depends(get_session_factory),
    client: LrclibClient = Depends(get_lrclib_client), covers: CoverClient = Depends(get_cover_client),
):
    path = Path(body.path).expanduser()
    if not path.is_absolute() or not path.is_file():
        raise AppError("invalid_path", "Path must be an absolute path to an existing file", 400)
    check_extension(path.name)
    song, created = register_song(session, path, SongSource.import_, cfg.default_language, Path(env.media_dir))
    if created:
        background.add_task(discover_for_songs, factory, client, [song.id])
        background.add_task(fetch_covers_for_songs, factory, covers, [song.id])
    return song


@router.post("/library/import", response_model=ScanOut, dependencies=[Depends(path_access)])
def import_path(
    body: ImportTreeRequest, background: BackgroundTasks, session: Session = Depends(get_session),
    cfg: RuntimeSettings = Depends(get_cfg), factory: sessionmaker = Depends(get_session_factory),
    client: LrclibClient = Depends(get_lrclib_client), covers: CoverClient = Depends(get_cover_client),
):
    """Import one audio file or a whole folder (optionally with its subfolders)."""
    path = Path(body.path).expanduser()
    if not path.is_absolute() or not (path.is_file() or path.is_dir()):
        raise AppError("invalid_path", "Path must be an absolute path to an existing file or folder", 400)
    if path.is_file():
        check_extension(path.name)
    result = import_tree(session, path, body.recursive, body.copy_files, cfg.default_language, Path(env.media_dir),
                         accept=name_filter(body.include, body.exclude))
    if result.new_song_ids:
        background.add_task(discover_for_songs, factory, client, result.new_song_ids)
        background.add_task(fetch_covers_for_songs, factory, covers, result.new_song_ids)
    return ScanOut(added=result.added, skipped=result.skipped, unavailable=0, filtered=result.filtered, errors=result.errors)


@router.post("/library/import-many", response_model=ScanOut, dependencies=[Depends(path_access)])
def import_many(
    body: ImportManyRequest, background: BackgroundTasks, session: Session = Depends(get_session),
    cfg: RuntimeSettings = Depends(get_cfg), factory: sessionmaker = Depends(get_session_factory),
    client: LrclibClient = Depends(get_lrclib_client), covers: CoverClient = Depends(get_cover_client),
):
    """Import several audio files and/or folders at once (what the folder browser's "Import selected" sends)."""
    accept = name_filter(body.include, body.exclude)  # validated before anything is imported
    total = ScanOut(added=0, skipped=0, unavailable=0, errors=[])
    new_ids: list[int] = []
    seen: set[Path] = set()
    for raw in body.paths:
        path = Path(raw).expanduser()
        if not path.is_absolute() or not (path.is_file() or path.is_dir()):
            total.errors.append(f"{raw}: not an existing file or folder")
            continue
        path = path.resolve()
        if path in seen:
            continue
        seen.add(path)
        if path.is_file():
            try:
                check_extension(path.name)
            except AppError as e:
                total.errors.append(f"{path.name}: {e.message}")
                continue
        result = import_tree(session, path, body.recursive, body.copy_files, cfg.default_language, Path(env.media_dir), accept=accept)
        total.added += result.added
        total.skipped += result.skipped
        total.filtered += result.filtered
        total.errors += result.errors
        new_ids += result.new_song_ids
    if new_ids:
        background.add_task(discover_for_songs, factory, client, new_ids)
        background.add_task(fetch_covers_for_songs, factory, covers, new_ids)
    return total


@router.post("/library/scan", response_model=ScanOut)
def scan(
    background: BackgroundTasks, session: Session = Depends(get_session),
    cfg: RuntimeSettings = Depends(get_cfg), factory: sessionmaker = Depends(get_session_factory),
    client: LrclibClient = Depends(get_lrclib_client), covers: CoverClient = Depends(get_cover_client),
):
    result = scan_library(session, cfg.library_dirs, cfg.default_language)
    if result.new_song_ids:
        background.add_task(discover_for_songs, factory, client, result.new_song_ids)
        background.add_task(fetch_covers_for_songs, factory, covers, result.new_song_ids)
    return ScanOut(**{k: getattr(result, k) for k in ("added", "skipped", "unavailable", "errors")})


@router.patch("/songs/{song_id}", response_model=SongOut)
def patch_song(body: SongPatch, song: Song = Depends(get_song), session: Session = Depends(get_session)):
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is not None or key == "album":
            setattr(song, key, value)
            if key == "language":
                song.language_source = "manual"  # a language somebody chose is never overridden by detection
    session.commit()
    return song


@router.post("/songs/{song_id}/language/detect", response_model=SongOut)
def detect_song_language(song: Song = Depends(get_song), session: Session = Depends(get_session)):
    """Guess the language from the song's current lyrics and set it (also over an earlier manual choice: this is an
    explicit request). 422 when the lyrics are missing, too short or not clearly in one language."""
    lyrics = session.query(Lyrics).filter_by(song_id=song.id, is_active=True).order_by(Lyrics.id.desc()).first()
    if lyrics is None:
        raise AppError("no_lyrics", "This song has no lyrics yet, so there is nothing to detect the language from", 422)
    found = detect_language("\n".join(l.text for l in lyrics.lines))
    if found is None:
        raise AppError("language_unclear", "The lyrics are too short or not clearly in one language. Choose the language yourself.", 422)
    song.language, song.language_source = found.language, "detected"
    session.commit()
    return song


@router.post("/songs/bulk-delete", response_model=BulkDeleteOut)
def bulk_delete_songs(body: BulkDeleteRequest, session: Session = Depends(get_session)):
    """Remove many songs at once, each as a single delete would (library files are only hidden)."""
    out = {"hidden": 0, "deleted": 0, "missing": 0}
    for song_id in dict.fromkeys(body.ids):
        song = session.get(Song, song_id)
        if song is None or song.removed:
            out["missing"] += 1
            continue
        out[remove_song(session, song, Path(env.media_dir))] += 1
    return out


@router.delete("/songs/{song_id}")
def delete_song(song: Song = Depends(get_song), session: Session = Depends(get_session)):
    """Remove from the library. Songs used in place are only hidden; uploaded/imported copies are deleted."""
    return {"result": remove_song(session, song, Path(env.media_dir))}


def _image(data: bytes, mime: str) -> Response:
    return Response(content=data, media_type=mime, headers={"Cache-Control": "no-cache"})


@router.get("/songs/{song_id}/cover")
def cover(song: Song = Depends(get_song), session: Session = Depends(get_session)):
    """The song's cover: art embedded in the audio file first, else a cover kept in the covers folder."""
    found = extract_cover(Path(song.file_path)) if Path(song.file_path).is_file() and song.cover_source != "custom" else None
    if found is not None and song.cover_source in (None, "none", "choose", "embedded"):
        if song.cover_source != "embedded" or song.has_cover is not True:
            song.cover_source, song.has_cover = "embedded", True
            session.commit()
    elif found is None:
        found = stored_cover(song)
        if found is None:
            if song.has_cover is not False:
                song.has_cover = False
                session.commit()
            raise AppError("no_cover", "This song has no cover art", 404)
        if song.has_cover is not True:
            song.has_cover = True
            session.commit()
    data, mime = found
    # art inside the audio file never changes; a stored cover can be replaced, so it is revalidated
    cache = "public, max-age=86400" if song.cover_source == "embedded" else "no-cache"
    return Response(content=data, media_type=mime, headers={"Cache-Control": cache})


def _unavailable(e: CoverUnavailable) -> AppError:
    return AppError("covers_unavailable", f"The cover service is unavailable: {e}", 502)


@router.post("/songs/{song_id}/cover/auto")
def cover_auto(song: Song = Depends(get_song), session: Session = Depends(get_session), covers: CoverClient = Depends(get_cover_client)):
    """Look for a cover now (the same lookup that runs after a song is added). A found cover is saved; if the match is not
    clear, `status` is 'choose' and the candidates are on GET .../cover/candidates."""
    if song.cover_source in ("none", "choose"):
        song.cover_source = None  # asking again by hand overrides the remembered miss
    try:
        return {"status": find_cover(session, song, covers)}
    except CoverUnavailable as e:
        raise _unavailable(e)


@router.get("/songs/{song_id}/cover/candidates")
def cover_candidates(
    q: str | None = None, song: Song = Depends(get_song), covers: CoverClient = Depends(get_cover_client),
):
    """Releases that might be this song's album, best match first (nothing is saved)."""
    try:
        if q and q.strip():
            found = covers.search("", q.strip(), q.strip())
        else:
            found = covers.search(song.artist, song.album, song.title)
    except CoverUnavailable as e:
        raise _unavailable(e)
    seen: set[str] = set()
    out = []
    for c in sorted(found, key=lambda c: -c.score):
        key = f"{c.title.lower()}|{c.artist.lower()}"
        if key in seen:
            continue
        seen.add(key)
        out.append({"id": c.mbid, "title": c.title, "artist": c.artist, "date": c.date, "score": c.score})
    return out[:8]


@router.get("/songs/{song_id}/cover/candidates/{mbid}/image")
def cover_candidate_image(mbid: str, song: Song = Depends(get_song), covers: CoverClient = Depends(get_cover_client)):
    """A candidate's front cover (a small one), fetched through the server: the browser never talks to the cover service."""
    if not mbid.replace("-", "").isalnum() or len(mbid) > 40:
        raise AppError("invalid_id", "Not a release id", 400)
    try:
        found = covers.front(mbid, 250)
    except CoverUnavailable as e:
        raise _unavailable(e)
    if found is None:
        raise AppError("no_cover", "This release has no cover art", 404)
    return _image(*found)


@router.post("/songs/{song_id}/cover/choose", response_model=SongOut)
def cover_choose(
    body: dict, song: Song = Depends(get_song), session: Session = Depends(get_session), covers: CoverClient = Depends(get_cover_client),
):
    mbid = str(body.get("id", ""))
    if not mbid or not mbid.replace("-", "").isalnum() or len(mbid) > 40:
        raise AppError("invalid_id", "Choose one of the listed covers", 400)
    try:
        found = covers.front(mbid)
    except CoverUnavailable as e:
        raise _unavailable(e)
    if found is None:
        raise AppError("no_cover", "This release has no cover art", 404)
    store_cover(session, song, found[0], found[1], "online")
    return song


@router.post("/songs/{song_id}/cover/upload", response_model=SongOut)
def cover_upload(file: UploadFile, song: Song = Depends(get_song), session: Session = Depends(get_session)):
    data = file.file.read(10 * 1024 * 1024 + 1)
    valid = validate_image(data)
    if valid is None:
        raise AppError("invalid_image", "That is not a JPEG, PNG, GIF or WebP image (or it is larger than 10 MB)", 422)
    store_cover(session, song, valid[0], valid[1], "custom")
    return song


@router.delete("/songs/{song_id}/cover", response_model=SongOut)
def cover_remove(song: Song = Depends(get_song), session: Session = Depends(get_session)):
    """Forget a cover kept in the covers folder (art embedded in the audio file is never touched)."""
    remove_cover(session, song)
    song.has_cover = extract_cover(Path(song.file_path)) is not None if Path(song.file_path).is_file() else False
    song.cover_source = "embedded" if song.has_cover else None
    session.commit()
    return song


@router.get("/songs/{song_id}/audio")
def stream_audio(song: Song = Depends(get_song)):
    path = Path(song.file_path)
    if not path.is_file():
        raise AppError("file_missing", "The audio file is no longer available", 404)
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type)  # Starlette handles HTTP Range
