"""The timing editor's data: a song may carry its own start time for every line of its lyrics. Only times are stored (never text), so the
lyrics cannot be changed this way. Everything that reads line times goes through `effective_times` / `effective_spans`."""
import json
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import LyricLine, Lyrics, Song
from app.db.models.types import utcnow

MIN_GAP = 0.05  # seconds between two timed lines (the editor keeps it; the server only checks the order)


def edited_times(song: Song, lyrics: Lyrics) -> list[float | None] | None:
    """The saved times when they still fit the lyrics (same number of lines), else None."""
    if song.lyrics_times_edited is None or not lyrics.is_active:  # older lyrics (kept for old games) never take the edit
        return None
    try:
        times = json.loads(song.lyrics_times_edited)
    except ValueError:
        return None
    return times if isinstance(times, list) and len(times) == len(lyrics.lines) else None


def effective_times(song: Song, lyrics: Lyrics) -> list[float | None]:
    """Start time of every line, without the song's offset: the edited one, else the lyrics' own."""
    edited = edited_times(song, lyrics)
    return edited if edited is not None else [l.start_time for l in lyrics.lines]


def effective_synced(song: Song, lyrics: Lyrics) -> bool:
    """Lyrics count as timed when they came timed, or when an edit gave every line a time."""
    if lyrics.is_synced:
        return True
    edited = edited_times(song, lyrics)
    return edited is not None and bool(edited) and all(t is not None for t in edited)


def effective_spans(song: Song, lyrics: Lyrics) -> dict[int, tuple[float | None, float | None]]:
    """line id -> (start, end) as the game uses them: with an edit a line ends where the next timed line starts."""
    lines = list(lyrics.lines)
    edited = edited_times(song, lyrics)
    if edited is None:
        return {l.id: (l.start_time, l.end_time) for l in lines}
    spans: dict[int, tuple[float | None, float | None]] = {}
    for i, l in enumerate(lines):
        start = edited[i]
        if start is None:
            spans[l.id] = (None, None)
            continue
        nxt = next((t for t in edited[i + 1:] if t is not None), None)
        if nxt is not None:
            end: float | None = nxt
        elif l.end_time is not None and l.start_time is not None:
            end = max(start + 0.1, l.end_time + (start - l.start_time))
        else:
            end = start + 4.0
        spans[l.id] = (start, end)
    return spans


def validate_times(times: list[float | None], line_count: int, duration: float) -> list[float | None]:
    if len(times) != line_count:
        raise AppError("timing_mismatch", "The number of times does not match the number of lyric lines", 400)
    out: list[float | None] = []
    last = -1.0
    for t in times:
        if t is None:
            out.append(None)
            continue
        if t < 0 or (duration > 0 and t > duration):
            raise AppError("timing_out_of_range", "A time is outside the song", 400)
        t = round(float(t), 2)
        if t < last:
            raise AppError("timing_order", "The lines must stay in order", 400)
        last = t
        out.append(t)
    return out


def timing_view(song: Song, lyrics: Lyrics) -> dict:
    """What the editor opens with: effective times including the song's offset (the editor folds the offset in when it saves)."""
    times = effective_times(song, lyrics)
    off = song.lyrics_offset or 0.0
    return {
        "lines": [
            {"text": l.text, "time": None if t is None else round(t + off, 2), "original": l.start_time}
            for l, t in zip(lyrics.lines, times)
        ],
        "duration": song.duration, "edited": song.lyrics_times_edited is not None, "edited_at": song.lyrics_times_edited_at,
        "synced": lyrics.is_synced,
    }


def save_timing(session: Session, song: Song, lyrics: Lyrics, times: list[float | None]) -> None:
    """Store the times (they already include the offset, which goes back to 0). All equal to the original: no edit at all."""
    clean = validate_times(times, len(lyrics.lines), song.duration)
    originals = [None if l.start_time is None else round(l.start_time, 2) for l in lyrics.lines]
    if clean == originals:
        song.lyrics_times_edited, song.lyrics_times_edited_at = None, None
    else:
        song.lyrics_times_edited, song.lyrics_times_edited_at = json.dumps(clean), utcnow()
    song.lyrics_offset = 0.0
    session.commit()


def reset_timing(session: Session, song: Song) -> None:
    song.lyrics_times_edited, song.lyrics_times_edited_at = None, None
    session.commit()


def keep_edit_for(song: Song, old_texts: list[str], new_texts: list[str]) -> None:
    """New lyrics arrived: an edit only survives when the lines (their text) are exactly the same."""
    if song.lyrics_times_edited is not None and old_texts != new_texts:
        song.lyrics_times_edited, song.lyrics_times_edited_at = None, None


def lrc_text(song: Song, lyrics: Lyrics) -> str:
    from app.services.lyrics.lrc_writer import build_lrc

    off = song.lyrics_offset or 0.0
    lines = [(None if t is None else max(0.0, t + off), l.text) for l, t in zip(lyrics.lines, effective_times(song, lyrics))]
    return build_lrc(song.title, song.artist, song.album, song.duration, lines)
