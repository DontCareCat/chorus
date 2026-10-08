import re
from dataclasses import dataclass, field

TIME = re.compile(r"\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]")
TAG = re.compile(r"^\[([A-Za-z]+):([^\]]*)\]\s*$")
WORD_TIME = re.compile(r"<\d+:\d{2}(?:[.:]\d{1,3})?>")


@dataclass
class RawLine:
    start: float | None
    text: str


@dataclass
class RawLyrics:
    lines: list[RawLine]
    is_synced: bool
    tags: dict[str, str] = field(default_factory=dict)


def _seconds(m: re.Match) -> float:
    minutes, seconds, frac = int(m.group(1)), int(m.group(2)), m.group(3)
    return minutes * 60 + seconds + (float("0." + frac) if frac else 0.0)


def parse_lyrics_text(text: str) -> RawLyrics:
    """Parse LRC (several timestamps per line, id tags, [offset:], enhanced word tags) or plain text."""
    text = text.lstrip("﻿")
    tags: dict[str, str] = {}
    timed: list[RawLine] = []
    plain: list[RawLine] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        tag = TAG.match(line)
        if tag and not TIME.match(line):
            tags[tag.group(1).lower()] = tag.group(2).strip()
            continue
        stamps = list(TIME.finditer(line))
        if stamps:
            body = WORD_TIME.sub("", TIME.sub("", line)).strip()
            for m in stamps:
                timed.append(RawLine(_seconds(m), body))
        else:
            plain.append(RawLine(None, line))
    if timed:
        offset_ms = float(tags.get("offset", "0") or 0) if re.fullmatch(r"[+-]?\d+(\.\d+)?", tags.get("offset", "0") or "0") else 0.0
        for ln in timed:  # LRC convention: positive offset = lyrics shown earlier
            ln.start = max(0.0, ln.start - offset_ms / 1000.0)
        timed.sort(key=lambda l: l.start)  # stable: ties keep file order
        return RawLyrics(timed, True, tags)
    return RawLyrics(plain, False, tags)
