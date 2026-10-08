import re
from dataclasses import dataclass
from pathlib import Path

import mutagen

from app.core.errors import AppError

AUDIO_EXTS = {".mp3", ".m4a", ".flac", ".ogg", ".opus", ".wav"}


@dataclass
class Tags:
    title: str
    artist: str
    album: str | None
    duration: float


def _first(tags, key: str) -> str | None:
    try:
        value = tags.get(key) if tags is not None else None
    except Exception:
        return None
    if not value:
        return None
    text = str(value[0] if isinstance(value, list) else value).strip()
    return text or None


def read_tags(path: Path) -> Tags:
    """Read tags with mutagen; fall back to 'Artist - Title' in the file name. Raises AppError if not audio."""
    try:
        f = mutagen.File(path, easy=True)
    except Exception:
        f = None
    if f is None or getattr(f, "info", None) is None or not getattr(f.info, "length", 0):
        raise AppError("invalid_audio", f"{path.name} is not a readable audio file", 400)
    tags = getattr(f, "tags", None)
    title, artist, album = _first(tags, "title"), _first(tags, "artist"), _first(tags, "album")
    if not title or not artist:
        m = re.match(r"^\s*(.+?)\s+-\s+(.+?)\s*$", path.stem)
        if m:
            artist = artist or m.group(1)
            title = title or m.group(2)
    return Tags(title=title or path.stem, artist=artist or "", album=album, duration=float(f.info.length))


# ---------- embedded cover art ----------
MAX_COVER_BYTES = 10 * 1024 * 1024
_IMAGE_MAGIC = ((b"\xff\xd8\xff", "image/jpeg"), (b"\x89PNG\r\n\x1a\n", "image/png"), (b"GIF8", "image/gif"))


def _sniff(data: bytes) -> str | None:
    """Image type from the bytes themselves; embedded MIME fields are often wrong or missing."""
    for magic, mime in _IMAGE_MAGIC:
        if data.startswith(magic):
            return mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _front(pictures: list) -> object | None:
    """Prefer the 'front cover' picture (type 3), else the first one."""
    return next((p for p in pictures if getattr(p, "type", None) == 3), pictures[0] if pictures else None)


def extract_cover(path: Path) -> tuple[bytes, str] | None:
    """Embedded album art as (bytes, mime), or None. Handles ID3 (mp3/wav), MP4/M4A, FLAC, Ogg Vorbis/Opus."""
    import base64

    from mutagen.flac import Picture
    from mutagen.mp4 import MP4Cover

    try:
        f = mutagen.File(path)
    except Exception:
        return None
    if f is None:
        return None
    data: bytes | None = None
    try:
        pics = getattr(f, "pictures", None)  # FLAC
        tags = getattr(f, "tags", None)
        if pics:
            data = _front(list(pics)).data  # type: ignore[union-attr]
        elif tags is not None and hasattr(tags, "getall"):  # ID3
            apic = _front(tags.getall("APIC"))
            data = apic.data if apic is not None else None  # type: ignore[union-attr]
        elif tags is not None and "covr" in tags:  # MP4 / M4A
            covers = tags["covr"]
            data = bytes(covers[0]) if covers and isinstance(covers[0], (MP4Cover, bytes)) else None
        elif tags is not None:  # Ogg Vorbis / Opus: base64 FLAC picture block in a comment
            blocks = tags.get("metadata_block_picture") or tags.get("METADATA_BLOCK_PICTURE")
            if blocks:
                data = Picture(base64.b64decode(blocks[0])).data
    except Exception:
        return None
    if not data or len(data) > MAX_COVER_BYTES:
        return None
    mime = _sniff(data)
    return (data, mime) if mime else None
