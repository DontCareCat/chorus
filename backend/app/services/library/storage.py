import hashlib
import re
import shutil
import tempfile
from pathlib import Path
from typing import BinaryIO

from app.core.errors import AppError
from app.services.library.tags import AUDIO_EXTS

CHUNK = 1024 * 1024


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


def check_extension(name: str) -> str:
    ext = Path(name).suffix.lower()
    if ext not in AUDIO_EXTS:
        raise AppError("unsupported_audio", f"Unsupported audio type '{ext or name}'", 400)
    return ext


def store_in_media(src: Path, digest: str, media_dir: Path) -> Path:
    """Copy a file into MEDIA_DIR as <sha256><ext> (idempotent)."""
    media_dir.mkdir(parents=True, exist_ok=True)
    dest = media_dir / f"{digest}{src.suffix.lower()}"
    if not dest.exists():
        shutil.copyfile(src, dest)
    return dest


def save_upload(stream: BinaryIO, filename: str, max_bytes: int) -> tuple[Path, str]:
    """Write an upload into a private temp dir under its (sanitised) original name, hashing on the way.

    The caller registers the file and then removes `path.parent` (shutil.rmtree).
    """
    check_extension(filename)
    safe = re.sub(r"[\x00-\x1f/\\]", "_", Path(filename).name)[:200] or "upload"
    tmpdir = Path(tempfile.mkdtemp(prefix="chorus-upload-"))
    path = tmpdir / safe
    h = hashlib.sha256()
    size = 0
    try:
        with path.open("wb") as out:
            while chunk := stream.read(CHUNK):
                size += len(chunk)
                if size > max_bytes:
                    raise AppError("file_too_large", "Upload exceeds the size limit", 413)
                h.update(chunk)
                out.write(chunk)
    except Exception:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise
    return path, h.hexdigest()
