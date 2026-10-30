import mimetypes
import time
import shutil
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Query, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import current_user, get_cfg, get_cover_client, get_lrclib_client, get_session_factory, get_song, get_youtube_client, path_access
from app.core.config import settings as env
from app.core.errors import AppError
from app.db.models.types import utcnow
from app.db.database import get_session
from app.db.models import Game, Lyrics, LyricsStatus, Song, SongSource, User
from app.schemas.song import BulkDeleteOut, BulkDeleteRequest, ImportManyRequest, ImportRequest, ImportTreeRequest, RetryOut, RetryRequest, ScanOut, SongOut, SongPatch, YouTubeImportFailure, YouTubeImportOut, YouTubeImportRequest, YouTubePreviewOut, YouTubeRequest
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
from app.services.lyrics.stall import is_stalled
from app.services.settings import RuntimeSettings, load_settings
from app.services.youtube import YouTubeClient, YouTubeUnavailable, add_youtube_video, clean_title, has_stale, parse_video_id, refresh_stale

IMPORT_SECONDS = 25  # of one import call

router = APIRouter(prefix="/api", tags=["songs"], dependencies=[Depends(current_user)])


@router.get("/songs", response_model=list[SongOut])
def list_songs(
    background: BackgroundTasks, session: Session = Depends(get_session), user: User = Depends(current_user),
    factory: sessionmaker = Depends(get_session_factory), youtube: YouTubeClient = Depends(get_youtube_client),
):
    songs = list(session.scalars(select(Song).where(Song.removed.is_(False)).order_by(Song.artist, Song.title)))
    cfg = load_settings(session)
    timeout, now = cfg.lyrics_timeout_minutes, utcnow()
    if cfg.youtube_enabled and any(s.source == SongSource.youtube for s in songs) and has_stale(session):
        background.add_task(refresh_stale, factory, youtube)
    if not cfg.youtube_enabled:  # switched off: the songs stay, but cannot be played (shown like a missing file)
        for s in songs:
            if s.source == SongSource.youtube:
                session.expunge(s)
                s.available = False
    mine = {
        r.song_id: r
        for r in session.execute(
            select(Game.song_id, func.max(Game.score).label("best"), func.count(Game.id).label("n"), func.max(Game.finished_at).label("last"))
            .where(Game.user_id == user.id, Game.finished_at.is_not(None))
            .group_by(Game.song_id)
        )
    }
    for s in songs:  # transient attributes, read by SongOut
        s.lyrics_stalled = is_stalled(s, timeout, now)
        r = mine.get(s.id)
        s.best_score, s.plays, s.last_played_at = (r.best, r.n, r.last) if r else (None, 0, None)
    return songs


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


@router.get("/songs/youtube/preview", response_model=YouTubePreviewOut)
def preview_youtube_song(
    url: str = Query(min_length=1, max_length=500), session: Session = Depends(get_session),
    cfg: RuntimeSettings = Depends(get_cfg), youtube: YouTubeClient = Depends(get_youtube_client),
):
    """What adding this link would give (cleaned title and artist, or the song already in the library). Saves nothing."""
    if not cfg.youtube_enabled:
        raise AppError("youtube_disabled", "YouTube songs are switched off in Settings", 403)
    video_id = parse_video_id(url)
    if video_id is None:
        raise AppError("bad_youtube_link", "That is not a YouTube video link", 422)
    existing = session.scalar(select(Song).where(Song.youtube_id == video_id, Song.removed.is_(False)))
    if existing is not None:
        return YouTubePreviewOut(
            video_id=video_id, title=existing.title, artist=existing.artist, channel=existing.youtube_channel or "",
            existing_id=existing.id, existing_title=existing.title,
        )
    try:
        info = youtube.info(video_id)
    except YouTubeUnavailable as e:
        raise AppError("youtube_unreachable", "YouTube could not be reached; try again in a moment", 503) from e
    artist, title = clean_title(info.title, info.channel)
    return YouTubePreviewOut(video_id=video_id, title=title or video_id, artist=artist, channel=info.channel)


@router.post("/songs/youtube", response_model=SongOut, status_code=201)
def add_youtube_song(
    body: YouTubeRequest, background: BackgroundTasks, response: Response, session: Session = Depends(get_session),
    cfg: RuntimeSettings = Depends(get_cfg), factory: sessionmaker = Depends(get_session_factory),
    client: LrclibClient = Depends(get_lrclib_client), youtube: YouTubeClient = Depends(get_youtube_client),
):
    """Add a song that is played from YouTube: only the video id and the facts YouTube shows publicly are kept."""
    if not cfg.youtube_enabled:
        raise AppError("youtube_disabled", "YouTube songs are switched off in Settings", 403)
    video_id = parse_video_id(body.url)
    if video_id is None:
        raise AppError("bad_youtube_link", "That is not a YouTube video link", 422)
    try:
        song, created = add_youtube_video(session, cfg, youtube, video_id, body.title, body.artist)
    except YouTubeUnavailable as e:
        raise AppError("youtube_unreachable", "YouTube could not be reached; try again in a moment", 503) from e
    if created:
        background.add_task(discover_for_songs, factory, client, [song.id])
    else:
        response.status_code = 200
    return song


@router.post("/songs/youtube/import", response_model=YouTubeImportOut)
def import_youtube_videos(
    body: YouTubeImportRequest, background: BackgroundTasks, session: Session = Depends(get_session),
    cfg: RuntimeSettings = Depends(get_cfg), factory: sessionmaker = Depends(get_session_factory),
    client: LrclibClient = Depends(get_lrclib_client), youtube: YouTubeClient = Depends(get_youtube_client),
):
    """Add several videos at once (the videos of a playlist, a batch at a time): each as 'Add from YouTube' would. One that cannot be added is
    reported and skipped; YouTube not answering stops the batch, the rest of it is reported as not tried."""
    if not cfg.youtube_enabled:
        raise AppError("youtube_disabled", "YouTube songs are switched off in Settings", 403)
    out = YouTubeImportOut(songs=[], added=0, existing=0, failed=[], not_tried=[])
    new_ids: list[int] = []
    ids = list(dict.fromkeys(body.video_ids))
    started = time.monotonic()
    for n, video_id in enumerate(ids):
        if time.monotonic() - started > IMPORT_SECONDS:  # a slow YouTube must not outlast the request: the rest is asked again
            out.not_tried = ids[n:]
            break
        if parse_video_id(video_id) != video_id:
            out.failed.append(YouTubeImportFailure(video_id=video_id, reason="not_a_video"))
            continue
        try:
            song, created = add_youtube_video(session, cfg, youtube, video_id)
        except AppError as e:  # gone, private or not embeddable
            out.failed.append(YouTubeImportFailure(video_id=video_id, reason=e.code))
            continue
        except YouTubeUnavailable:
            out.not_tried = ids[n:]
            break
        out.songs.append(song)
        if created:
            out.added += 1
            new_ids.append(song.id)
        else:
            out.existing += 1
    if new_ids and body.lookup:
        background.add_task(discover_for_songs, factory, client, new_ids)
    return out


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


@router.post("/songs/lyrics/retry", response_model=RetryOut)
def retry_lyrics(
    body: RetryRequest, background: BackgroundTasks, session: Session = Depends(get_session),
    factory: sessionmaker = Depends(get_session_factory), client: LrclibClient = Depends(get_lrclib_client),
):
    """Look for lyrics again, in the background: for the given songs, or (no `ids`) for every song that has none yet
    because the first try found nothing or never finished (a big import can hit the service's limits)."""
    query = select(Song.id).where(Song.removed.is_(False), Song.lyrics_status.in_([LyricsStatus.not_found, LyricsStatus.pending]))
    if body.ids is not None:
        query = select(Song.id).where(Song.removed.is_(False), Song.id.in_(body.ids), Song.lyrics_status != LyricsStatus.found)
    ids = list(session.scalars(query))
    if ids:
        session.execute(update(Song).where(Song.id.in_(ids)).values(lyrics_status=LyricsStatus.pending))  # shown as waiting again (the lookup bar, the clock) until the answer is in
        session.commit()
        background.add_task(discover_for_songs, factory, client, ids, True)
    return RetryOut(queued=len(ids))


@router.patch("/songs/{song_id}", response_model=SongOut)
def patch_song(
    body: SongPatch, background: BackgroundTasks, song: Song = Depends(get_song), session: Session = Depends(get_session),
    factory: sessionmaker = Depends(get_session_factory), client: LrclibClient = Depends(get_lrclib_client),
):
    changes = body.model_dump(exclude_unset=True)
    was_unknown = song.duration <= 0
    if changes.get("duration") is not None and song.source != SongSource.youtube:
        changes.pop("duration")  # a file's length is read from the file; only a YouTube song's length comes from the player (each time it plays)
    learned_length = changes.get("duration") is not None and was_unknown
    for key, value in changes.items():
        if value is not None or key == "album":
            setattr(song, key, value)
            if key == "language":
                song.language_source = "manual"  # a language somebody chose is never overridden by detection
    session.commit()
    if learned_length and song.lyrics_status != LyricsStatus.found:
        # the length makes the lyrics match better: look again (lyrics already attached are never replaced; the status is whatever the lookup finds)
        background.add_task(discover_for_songs, factory, client, [song.id])
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
    found = extract_cover(Path(song.file_path)) if song.file_path and Path(song.file_path).is_file() and song.cover_source != "custom" else None
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
    song.has_cover = extract_cover(Path(song.file_path)) is not None if song.file_path and Path(song.file_path).is_file() else False
    song.cover_source = "embedded" if song.has_cover else None
    session.commit()
    return song


@router.get("/songs/{song_id}/audio")
def stream_audio(song: Song = Depends(get_song)):
    if song.file_path is None:
        raise AppError("no_file", "This song is played from YouTube and has no audio file", 404)
    path = Path(song.file_path)
    if not path.is_file():
        raise AppError("file_missing", "The audio file is no longer available", 404)
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type)  # Starlette handles HTTP Range
