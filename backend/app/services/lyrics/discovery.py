import logging
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import LyricLine, Lyrics, LyricsSource, LyricsStatus, Song
from app.services.lyrics.cache import CachedLrclib
from app.services.lyrics.lrc import parse_lyrics_text
from app.services.lyrics.lrclib import LrclibUnavailable, LyricsCandidate
from app.services.lyrics.normalizer import NormalizedLyrics, normalize
from app.services.settings import RuntimeSettings

log = logging.getLogger(__name__)
CONFIDENT_DURATION_DIFF = 2.0
MAX_LYRICS_BYTES = 1_000_000


@dataclass
class DiscoveryResult:
    status: LyricsStatus
    lyrics: Lyrics | None = None
    candidates: list[LyricsCandidate] = field(default_factory=list)
    unsynced_hidden: int = 0  # plain-only candidates hidden because unsynchronized lyrics are not allowed
    warnings: list[str] = field(default_factory=list)
    error: str | None = None


def is_usable(c: LyricsCandidate, cfg: RuntimeSettings) -> bool:
    if c.instrumental:
        return False
    return c.is_synced or (cfg.allow_unsynchronized_lyrics and bool(c.plain_lyrics))


def rank(song: Song, candidates: list[LyricsCandidate]) -> list[LyricsCandidate]:
    return sorted(candidates, key=lambda c: (abs(c.duration - song.duration), not c.is_synced))


def attach_lyrics(
    session: Session, song: Song, text: str, source: LyricsSource, external_id: str | None,
    cfg: RuntimeSettings,
) -> tuple[Lyrics, NormalizedLyrics]:
    norm = normalize(parse_lyrics_text(text), song.duration)
    if not norm.is_synced and not cfg.allow_unsynchronized_lyrics:
        raise AppError(
            "unsynchronized_not_allowed",
            "These lyrics have no timestamps. Enable 'allow unsynchronized lyrics' in settings to use them.", 422,
        )
    for old in session.query(Lyrics).filter_by(song_id=song.id, is_active=True):
        old.is_active = False
        if song.lyrics_offset and (old.source, old.external_id) != (source, external_id):
            # the offset was tuned against the previous lyrics; different lyrics have their own timing
            norm.warnings.append(f"The timing adjustment ({song.lyrics_offset:+.1f} s) was reset because these are different lyrics.")
            song.lyrics_offset = 0.0
    lyrics = Lyrics(song=song, source=source, external_id=external_id, is_synced=norm.is_synced, is_active=True)
    lyrics.lines = [
        LyricLine(sequence=i, start_time=l.start, end_time=l.end, text=l.text) for i, l in enumerate(norm.lines)
    ]
    session.add(lyrics)
    song.lyrics_status = LyricsStatus.found
    session.commit()
    return lyrics, norm


def attach_candidate(
    session: Session, song: Song, c: LyricsCandidate, cfg: RuntimeSettings,
) -> tuple[Lyrics, NormalizedLyrics]:
    if c.instrumental:
        raise AppError("instrumental", "This track is marked as instrumental", 422)
    text = c.synced_lyrics or c.plain_lyrics
    if not text:
        raise AppError("no_lyrics", "This LRCLIB entry has no lyrics", 422)
    return attach_lyrics(session, song, text, LyricsSource.lrclib, str(c.id), cfg)


def _sidecar_text(song: Song) -> str | None:
    audio = Path(song.file_path)
    for p in (audio.with_suffix(".lrc"), audio.with_name(audio.name + ".lrc")):
        try:
            if p.is_file() and p.stat().st_size <= MAX_LYRICS_BYTES:
                return p.read_text(encoding="utf-8-sig", errors="replace")
        except OSError:
            continue
    return None


def _has_active_lyrics(session: Session, song: Song) -> bool:
    return session.query(Lyrics).filter_by(song_id=song.id, is_active=True).first() is not None


def discover_lyrics(
    session: Session, song: Song, lrclib: CachedLrclib, cfg: RuntimeSettings, skip_if_has_lyrics: bool = False,
) -> DiscoveryResult:
    """Sidecar .lrc → LRCLIB exact match → LRCLIB search. Attaches only confident matches.

    `skip_if_has_lyrics` (background discovery) never overrides lyrics the user already attached; and a lookup
    that finishes after the user attached lyrics by hand never downgrades the song's status.
    """
    if skip_if_has_lyrics and _has_active_lyrics(session, song):
        return DiscoveryResult(LyricsStatus.found)
    # 1. sidecar next to the audio file
    text = _sidecar_text(song)
    if text:
        try:
            lyrics, norm = attach_lyrics(session, song, text, LyricsSource.sidecar, None, cfg)
            return DiscoveryResult(LyricsStatus.found, lyrics, warnings=norm.warnings)
        except AppError as e:
            log.info("sidecar for %s unusable: %s", song.file_name, e.message)

    hidden = 0
    try:
        # 2. exact lookup
        exact = lrclib.get(song.artist, song.title, song.album, song.duration) if song.artist else None
        if exact is not None and abs(exact.duration - song.duration) <= CONFIDENT_DURATION_DIFF:
            if is_usable(exact, cfg):
                lyrics, norm = attach_candidate(session, song, exact, cfg)
                return DiscoveryResult(LyricsStatus.found, lyrics, warnings=norm.warnings)
            if not exact.instrumental and exact.plain_lyrics:
                hidden += 1
        # 3. search
        found = lrclib.search(f"{song.artist} {song.title}".strip())
    except LrclibUnavailable as e:
        return DiscoveryResult(LyricsStatus.pending, error=str(e))

    if skip_if_has_lyrics:
        session.refresh(song)
        if _has_active_lyrics(session, song):  # the user attached lyrics while we were searching
            return DiscoveryResult(LyricsStatus.found)
    usable = rank(song, [c for c in found if is_usable(c, cfg)])
    hidden += sum(1 for c in found if not c.instrumental and not c.is_synced and c.plain_lyrics and not is_usable(c, cfg))
    status = LyricsStatus.needs_choice if usable else LyricsStatus.not_found
    if not _has_active_lyrics(session, song):  # a song that has lyrics stays 'found' even if nothing better turns up
        song.lyrics_status = status
        session.commit()
    return DiscoveryResult(status, candidates=usable[:20], unsynced_hidden=hidden)


def replacement_candidates(session: Session, song: Song, lrclib: CachedLrclib, cfg: RuntimeSettings) -> DiscoveryResult:
    """Candidates for a song that already has lyrics. Nothing is attached: the user decides.

    The sidecar file and the confident exact match are exactly what `discover_lyrics` would pick again, so here
    they are only offered like any other candidate (the one in use is flagged by the caller).
    """
    found: dict[int, LyricsCandidate] = {}
    hidden = 0
    try:
        if song.artist:
            exact = lrclib.get(song.artist, song.title, song.album, song.duration)
            if exact is not None:
                found[exact.id] = exact
        for c in lrclib.search(f"{song.artist} {song.title}".strip()):
            found.setdefault(c.id, c)
    except LrclibUnavailable as e:
        return DiscoveryResult(LyricsStatus.found, error=str(e))
    usable = rank(song, [c for c in found.values() if is_usable(c, cfg)])
    hidden = sum(1 for c in found.values() if not c.instrumental and not c.is_synced and c.plain_lyrics and not is_usable(c, cfg))
    return DiscoveryResult(LyricsStatus.found, candidates=usable[:20], unsynced_hidden=hidden)
