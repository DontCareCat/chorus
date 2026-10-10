"""Folder browsing for the "Add music" picker, and the file-name patterns of imports.

Only names, kinds and sizes ever leave the machine: directories and audio files are listed, nothing is read.
"""
import os
import re
import string
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.core.errors import AppError
from app.services.library.tags import AUDIO_EXTS

MAX_PATTERN = 200
MAX_ENTRIES = 5000


@dataclass
class Entry:
    name: str
    kind: str  # dir | audio
    size: int | None = None
    link: bool = False  # a symbolic link (folders behind one are listed but not followed by an import)


def roots(library_dirs: list[str]) -> list[dict[str, str]]:
    """Places to start from: home, the configured library folders, mounted volumes / drives."""
    out: list[dict[str, str]] = [{"name": "Home", "path": str(Path.home())}]
    out += [{"name": Path(d).name or d, "path": d} for d in library_dirs if Path(d).expanduser().is_dir()]
    if sys.platform == "win32":
        out += [{"name": f"{c}:", "path": f"{c}:\\"} for c in string.ascii_uppercase if Path(f"{c}:\\").exists()]
    elif sys.platform == "darwin":
        volumes = Path("/Volumes")
        if volumes.is_dir():
            out += [{"name": v.name, "path": str(v)} for v in sorted(volumes.iterdir()) if v.is_dir()]
    else:
        for base in (Path("/media"), Path("/mnt")):
            if base.is_dir():
                out += [{"name": v.name, "path": str(v)} for v in sorted(base.iterdir()) if v.is_dir()]
        out.append({"name": "/", "path": "/"})
    seen: set[str] = set()
    return [r for r in out if not (r["path"] in seen or seen.add(r["path"]))]


def list_dir(path: Path, show_hidden: bool = False) -> list[Entry]:
    """Folders first, then audio files, each sorted by name. Raises AppError with a message a person can act on."""
    try:
        names = sorted(os.scandir(path), key=lambda e: (not e.is_dir(follow_symlinks=True), e.name.lower()))
    except FileNotFoundError:
        raise AppError("path_not_found", f"{path} does not exist", 404)
    except NotADirectoryError:
        raise AppError("not_a_folder", f"{path} is not a folder", 400)
    except PermissionError:
        raise AppError("path_forbidden", f"Chorus is not allowed to open {path}", 403)
    out: list[Entry] = []
    for e in names:
        if not show_hidden and e.name.startswith("."):
            continue
        try:
            link = e.is_symlink()
            if e.is_dir(follow_symlinks=True):
                out.append(Entry(e.name, "dir", None, link))
            elif Path(e.name).suffix.lower() in AUDIO_EXTS and e.is_file(follow_symlinks=True):
                out.append(Entry(e.name, "audio", e.stat().st_size, link))
        except OSError:
            continue  # a broken link or a file that vanished: leave it out
        if len(out) >= MAX_ENTRIES:
            break
    return out


def compile_pattern(pattern: str | None, label: str) -> re.Pattern[str] | None:
    """A case-insensitive pattern for file names; refused when empty, too long or not a valid regular expression."""
    if pattern is None or not pattern.strip():
        return None
    if len(pattern) > MAX_PATTERN:
        raise AppError("invalid_pattern", f"The {label} pattern is too long (at most {MAX_PATTERN} characters)", 422)
    try:
        return re.compile(pattern, re.IGNORECASE)
    except re.error as e:
        raise AppError("invalid_pattern", f"The {label} pattern is not a valid regular expression: {e}", 422)


def name_filter(include: str | None, exclude: str | None) -> Callable[[str], bool] | None:
    """A predicate on a file name: matches `include` (when given) and does not match `exclude`. None = accept everything.

    Patterns are only ever tried against a single file name (never file contents)."""
    inc, exc = compile_pattern(include, "include"), compile_pattern(exclude, "exclude")
    if inc is None and exc is None:
        return None

    def accept(name: str) -> bool:
        name = name[:255]
        return (inc is None or inc.search(name) is not None) and (exc is None or exc.search(name) is None)

    return accept
