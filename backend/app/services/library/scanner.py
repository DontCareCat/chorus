import os
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import Game, GameAnswer, Lyrics, LyricsStatus, Question, QuestionOption, Song, SongSource
from app.services.library.storage import check_extension, sha256_file, store_in_media
from app.services.library.tags import AUDIO_EXTS, extract_cover, read_tags


def register_song(
    session: Session, path: Path, source: SongSource, language: str, media_dir: Path | None = None,
    digest: str | None = None, restore_removed: bool = True,
) -> tuple[Song, bool]:
    """Create a Song for an audio file. Returns (song, created). Duplicate content → existing song.

    library: file used in place; import/upload: file copied into media_dir (caller passes the temp file for uploads).
    """
    check_extension(path.name)
    digest = digest or sha256_file(path)
    existing = session.scalar(select(Song).where(Song.content_hash == digest))
    if existing is not None and existing.removed:
        if not restore_removed:  # a scan never resurrects a song the user removed
            return existing, False
        existing.removed = False
        session.commit()
    if existing is not None:
        if source == SongSource.library and existing.source == SongSource.library and str(path) != existing.file_path:
            if not Path(existing.file_path).exists():  # moved file → re-link
                existing.file_path, existing.file_name, existing.available = str(path), path.name, True
                session.commit()
        return existing, False
    tags = read_tags(path)
    final = path
    if source != SongSource.library:
        assert media_dir is not None
        final = store_in_media(path, digest, media_dir)
    song = Song(
        title=tags.title, artist=tags.artist, album=tags.album, duration=tags.duration, sample_rate=tags.sample_rate, language=language,
        source=source, file_path=str(final.resolve()), file_name=path.name, content_hash=digest,
        available=True, lyrics_status=LyricsStatus.pending, has_cover=extract_cover(path) is not None,
    )
    session.add(song)
    session.commit()
    return song, True


@dataclass
class ScanResult:
    added: int = 0
    skipped: int = 0
    unavailable: int = 0
    errors: list[str] = field(default_factory=list)
    new_song_ids: list[int] = field(default_factory=list)


def walk_audio(root: Path, recursive: bool = True) -> Iterator[Path]:
    """Audio files under `root` (sorted, symlinked folders not followed, symlinks leading outside skipped)."""
    root = root.resolve()
    for dirpath, dirnames, files in os.walk(root, followlinks=False):
        dirnames.sort()
        for name in sorted(files):
            p = Path(dirpath) / name
            if p.suffix.lower() not in AUDIO_EXTS:
                continue
            if p.is_symlink() and root not in p.resolve().parents:
                continue
            yield p
        if not recursive:
            break


def import_tree(
    session: Session, root: Path, recursive: bool, copy: bool, language: str, media_dir: Path, restore_removed: bool = True,
) -> ScanResult:
    """Register every audio file under a folder (or the single file `root`).

    copy=False uses the files in place (source=library); copy=True copies them into MEDIA_DIR (source=import).
    """
    result = ScanResult()
    source = SongSource.import_ if copy else SongSource.library
    files = [root] if root.is_file() else list(walk_audio(root, recursive))
    for p in files:
        try:
            song, created = register_song(session, p, source, language, media_dir, restore_removed=restore_removed)
        except AppError as e:
            result.errors.append(f"{p.name}: {e.message}")
            continue
        if created:
            result.added += 1
            result.new_song_ids.append(song.id)
        else:
            result.skipped += 1
    return result


def scan_library(session: Session, dirs: list[str], language: str) -> ScanResult:
    """Walk the configured folders and register new audio files in place (removed songs stay removed)."""
    result = ScanResult()
    known = {p for (p,) in session.execute(select(Song.file_path).where(Song.source == SongSource.library))}
    for d in dirs:
        root = Path(d).expanduser()
        if not root.is_dir():
            result.errors.append(f"{d}: not a directory")
            continue
        for p in walk_audio(root):
            if str(p) in known:
                result.skipped += 1
                continue
            try:
                song, created = register_song(session, p, SongSource.library, language, restore_removed=False)
            except AppError as e:
                result.errors.append(f"{p.name}: {e.message}")
                continue
            if created:
                result.added += 1
                result.new_song_ids.append(song.id)
            else:
                result.skipped += 1
    for song in session.scalars(select(Song).where(Song.source == SongSource.library, Song.removed.is_(False))):
        ok = Path(song.file_path).exists()
        if song.available and not ok:
            result.unavailable += 1
        song.available = ok
    session.commit()
    return result


def remove_song(session: Session, song: Song, media_dir: Path) -> str:
    """Take a song out of the library. Returns 'hidden' (library file kept on disk) or 'deleted'.

    Library songs are only hidden: the user's own files are never touched, and the stored hash keeps a later
    scan from adding them back. Imported / uploaded songs are deleted completely, including the copy in MEDIA_DIR.
    """
    if song.source == SongSource.library:
        song.removed = True
        session.commit()
        return "hidden"
    session.execute(delete(GameAnswer).where(GameAnswer.game_id.in_(select(Game.id).where(Game.song_id == song.id))))
    session.execute(delete(Game).where(Game.song_id == song.id))
    session.execute(delete(QuestionOption).where(QuestionOption.question_id.in_(select(Question.id).where(Question.song_id == song.id))))
    session.execute(delete(Question).where(Question.song_id == song.id))
    for lyrics in session.scalars(select(Lyrics).where(Lyrics.song_id == song.id)):
        session.delete(lyrics)  # cascades to its lines
    session.flush()
    path = Path(song.file_path)
    session.delete(song)
    session.commit()
    try:
        if path.is_file() and media_dir.resolve() in path.resolve().parents:  # only ever delete our own copy
            path.unlink()
    except OSError:
        pass
    return "deleted"
