"""Write an .lrc file from a song's lyric lines (the export of the timing editor). Mirrored by packages/core lrc-writer.ts in the Android app."""
import re
from decimal import ROUND_HALF_UP, Decimal

_BAD_FILE_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def stamp(seconds: float) -> str:
    """[mm:ss.xx] in hundredths, rounded half up; minutes may pass 99."""
    hundredths = int((Decimal(str(max(0.0, seconds))) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    minutes, rest = divmod(hundredths, 6000)
    return f"[{minutes:02d}:{rest // 100:02d}.{rest % 100:02d}]"


def length_tag(duration: float) -> str:
    total = int(Decimal(str(duration)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return f"{total // 60}:{total % 60:02d}"


def file_name(artist: str, title: str) -> str:
    """`Artist - Title.lrc`; characters a file name cannot hold become `_`."""
    base = f"{artist.strip()} - {title.strip()}" if artist.strip() else title.strip()
    base = _BAD_FILE_CHARS.sub("_", base).strip(" .") or "lyrics"
    return f"{base}.lrc"


def build_lrc(title: str, artist: str, album: str | None, duration: float, lines: list[tuple[float | None, str]]) -> str:
    """UTF-8 text with `\\n` line ends and no BOM. Lines without a time are left out; an empty line keeps its time. Times are the effective ones (no [offset:] tag)."""
    out = [f"[ti:{title}]"]
    if artist:
        out.append(f"[ar:{artist}]")
    if album:
        out.append(f"[al:{album}]")
    if duration and duration > 0:
        out.append(f"[length:{length_tag(duration)}]")
    out.append("[re:Chorus]")
    for time, text in lines:
        if time is not None:
            out.append(f"{stamp(time)}{text}")
    return "\n".join(out) + "\n"
