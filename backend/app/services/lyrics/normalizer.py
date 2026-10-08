import html
import re
from dataclasses import dataclass, field

from app.core.errors import AppError
from app.services.lyrics.lrc import RawLyrics

MAX_LINE_SECONDS = 15.0
LAST_LINE_SECONDS = 5.0
DURATION_MISMATCH_SECONDS = 30.0

_MARKER_ONLY = re.compile(r"^\s*[\[(][^\])]*[\])]\s*$")  # [Chorus], (Instrumental)
_REPEAT = re.compile(r"\(\s*(?:x\s*\d+|\d+\s*x)\s*\)", re.IGNORECASE)
_SPEAKER = re.compile(r"^[A-Z][A-Z .'-]{1,20}:\s+")


@dataclass
class LineDraft:
    start: float | None
    end: float | None
    text: str


@dataclass
class NormalizedLyrics:
    lines: list[LineDraft]
    is_synced: bool
    warnings: list[str] = field(default_factory=list)


def clean_text(text: str) -> str:
    text = html.unescape(text)
    if _MARKER_ONLY.match(text):
        return ""
    text = _REPEAT.sub("", text).replace("♪", "").replace("♫", "")
    text = _SPEAKER.sub("", text.strip())
    return re.sub(r"\s+", " ", text).strip()


def normalize(raw: RawLyrics, duration: float) -> NormalizedLyrics:
    warnings: list[str] = []
    entries = [(l.start, clean_text(l.text)) for l in raw.lines]

    if not raw.is_synced:
        lines = [LineDraft(None, None, t) for _, t in entries if t]
        if not lines:
            raise AppError("empty_lyrics", "The lyrics contain no text", 422)
        return NormalizedLyrics(lines, False, warnings)

    lines: list[LineDraft] = []
    dropped = 0
    for i, (start, text) in enumerate(entries):
        if not text:  # gap marker: only ends the previous line
            continue
        nxt = entries[i + 1][0] if i + 1 < len(entries) else None
        if nxt is None:
            end = min(start + LAST_LINE_SECONDS, duration)
        else:
            end = min(nxt, start + MAX_LINE_SECONDS)
        if end <= start:
            dropped += 1
            continue
        lines.append(LineDraft(round(start, 3), round(end, 3), text))
    if dropped:
        warnings.append(f"{dropped} line(s) dropped (identical or inverted timestamps)")
    if not lines:
        raise AppError("empty_lyrics", "The lyrics contain no timed text", 422)
    if max(start for start, _ in entries) > duration + DURATION_MISMATCH_SECONDS:  # checked on raw times: such lines are dropped
        warnings.append("Lyrics extend well beyond the audio length; they probably belong to a different version")
    return NormalizedLyrics(lines, True, warnings)
