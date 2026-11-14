from typing import Literal

from urllib.parse import quote

from fastapi import APIRouter, Depends, Response, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import current_user, get_cfg, get_lrclib, get_song
from app.core.errors import AppError
from app.db.database import get_session
from app.db.models import Lyrics, LyricsSource, Song
from app.schemas.lyrics import AttachRequest, CandidateOut, DiscoveryOut, LineOut, LyricsOut, TimingIn, TimingOut
from app.services.lyrics.cache import CachedLrclib
from app.services.lyrics.discovery import (
    MAX_LYRICS_BYTES, DiscoveryResult, attach_candidate, attach_lyrics, discover_lyrics, is_usable, rank, replacement_candidates,
)
from app.services.lyrics.lrclib import LrclibUnavailable, LyricsCandidate
from app.services.lyrics import timing as timing_service
from app.services.lyrics.lrc_writer import file_name
from app.services.settings import RuntimeSettings

router = APIRouter(prefix="/api", tags=["lyrics"], dependencies=[Depends(current_user)])


def lyrics_out(lyrics: Lyrics, warnings: list[str] | None = None) -> LyricsOut:
    song = lyrics.song
    spans = timing_service.effective_spans(song, lyrics)  # the times the owner edited, when there are any
    return LyricsOut(
        id=lyrics.id, source=lyrics.source.value, external_id=lyrics.external_id, is_synced=timing_service.effective_synced(song, lyrics),
        lines=[LineOut(sequence=l.sequence, start_time=spans[l.id][0], end_time=spans[l.id][1], text=l.text) for l in lyrics.lines],
        warnings=warnings or [],
    )


def candidate_out(c: LyricsCandidate, cfg: RuntimeSettings, in_use_id: str | None = None) -> CandidateOut:
    return CandidateOut(in_use=in_use_id is not None and str(c.id) == in_use_id,
        id=c.id, artist=c.artist, title=c.title, album=c.album, duration=c.duration, synced=c.is_synced,
        has_plain=bool(c.plain_lyrics), instrumental=c.instrumental, usable=is_usable(c, cfg),
    )


def discovery_out(r: DiscoveryResult, cfg: RuntimeSettings, in_use_id: str | None = None) -> DiscoveryOut:
    return DiscoveryOut(
        status=r.status, lyrics=lyrics_out(r.lyrics, r.warnings) if r.lyrics else None,
        candidates=[candidate_out(c, cfg, in_use_id) for c in r.candidates], unsynced_hidden=r.unsynced_hidden,
        warnings=r.warnings, error=r.error,
    )


def _unavailable(e: LrclibUnavailable) -> AppError:
    return AppError("lrclib_unavailable", f"Lyrics service unavailable: {e}", 502)


@router.post("/songs/{song_id}/lyrics/discover", response_model=DiscoveryOut)
def discover(
    mode: Literal["auto", "replace"] = "auto", song: Song = Depends(get_song), session: Session = Depends(get_session),
    lrclib: CachedLrclib = Depends(get_lrclib), cfg: RuntimeSettings = Depends(get_cfg),
):
    """`auto` attaches a confident match. `replace` (the song already has lyrics) only lists candidates to choose from."""
    if mode == "replace":
        current = session.query(Lyrics).filter_by(song_id=song.id, is_active=True).order_by(Lyrics.id.desc()).first()
        return discovery_out(replacement_candidates(session, song, lrclib, cfg), cfg, current.external_id if current else None)
    return discovery_out(discover_lyrics(session, song, lrclib, cfg), cfg)


@router.get("/songs/{song_id}/lyrics/search", response_model=list[CandidateOut])
def search(
    q: str | None = None, song: Song = Depends(get_song), session: Session = Depends(get_session),
    lrclib: CachedLrclib = Depends(get_lrclib), cfg: RuntimeSettings = Depends(get_cfg),
):
    query = (q or f"{song.artist} {song.title}").strip()
    if not query:
        raise AppError("empty_query", "Search query is empty", 400)
    try:
        found = lrclib.search(query)
    except LrclibUnavailable as e:
        raise _unavailable(e)
    current = session.query(Lyrics).filter_by(song_id=song.id, is_active=True).order_by(Lyrics.id.desc()).first()
    return [candidate_out(c, cfg, current.external_id if current else None) for c in rank(song, found)[:30]]


@router.get("/songs/{song_id}/lyrics", response_model=LyricsOut)
def get_lyrics(song: Song = Depends(get_song), session: Session = Depends(get_session)):
    lyrics = session.query(Lyrics).filter_by(song_id=song.id, is_active=True).order_by(Lyrics.id.desc()).first()
    if lyrics is None:
        raise AppError("no_lyrics", "This song has no lyrics yet", 404)
    return lyrics_out(lyrics)


def _active(song: Song, session: Session) -> Lyrics:
    lyrics = session.query(Lyrics).filter_by(song_id=song.id, is_active=True).order_by(Lyrics.id.desc()).first()
    if lyrics is None:
        raise AppError("no_lyrics", "This song has no lyrics yet", 404)
    return lyrics


@router.get("/songs/{song_id}/lyrics/timing", response_model=TimingOut)
def get_timing(song: Song = Depends(get_song), session: Session = Depends(get_session)):
    return timing_service.timing_view(song, _active(song, session))


@router.put("/songs/{song_id}/lyrics/timing", response_model=TimingOut)
def put_timing(body: TimingIn, song: Song = Depends(get_song), session: Session = Depends(get_session)):
    """Saves a start time per line. Only times are accepted, never text."""
    lyrics = _active(song, session)
    timing_service.save_timing(session, song, lyrics, body.times)
    return timing_service.timing_view(song, lyrics)


@router.delete("/songs/{song_id}/lyrics/timing", response_model=TimingOut)
def delete_timing(song: Song = Depends(get_song), session: Session = Depends(get_session)):
    lyrics = _active(song, session)
    timing_service.reset_timing(session, song)
    return timing_service.timing_view(song, lyrics)


@router.get("/songs/{song_id}/lyrics.lrc")
def export_lrc(song: Song = Depends(get_song), session: Session = Depends(get_session)):
    lyrics = _active(song, session)
    text = timing_service.lrc_text(song, lyrics)
    if not any(t is not None for t in timing_service.effective_times(song, lyrics)):
        raise AppError("no_timing", "These lyrics have no timing yet, so there is nothing to export", 409)
    name = file_name(song.artist, song.title)
    return Response(text.encode("utf-8"), media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})


@router.post("/songs/{song_id}/lyrics", response_model=LyricsOut, status_code=201)
def attach(
    body: AttachRequest, song: Song = Depends(get_song), session: Session = Depends(get_session),
    lrclib: CachedLrclib = Depends(get_lrclib), cfg: RuntimeSettings = Depends(get_cfg),
):
    try:
        candidate = lrclib.get_by_id(body.lrclib_id)
    except LrclibUnavailable as e:
        raise _unavailable(e)
    if candidate is None:
        raise AppError("lyrics_not_found", "No such LRCLIB entry", 404)
    lyrics, norm = attach_candidate(session, song, candidate, cfg)
    return lyrics_out(lyrics, norm.warnings)


@router.post("/songs/{song_id}/lyrics/upload", response_model=LyricsOut, status_code=201)
def upload_lyrics(
    file: UploadFile, song: Song = Depends(get_song), session: Session = Depends(get_session),
    cfg: RuntimeSettings = Depends(get_cfg),
):
    raw = file.file.read(MAX_LYRICS_BYTES + 1)
    if len(raw) > MAX_LYRICS_BYTES:
        raise AppError("file_too_large", "Lyrics file is too large", 413)
    lyrics, norm = attach_lyrics(session, song, raw.decode("utf-8-sig", errors="replace"), LyricsSource.upload, None, cfg)
    return lyrics_out(lyrics, norm.warnings)


@router.delete("/lyrics/cache")
def clear_cache(lrclib: CachedLrclib = Depends(get_lrclib)):
    return {"deleted": lrclib.clear()}
