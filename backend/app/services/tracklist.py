"""Matching a list of tracks (from a Spotify playlist the person exported or typed) to the songs already in the library.

Spotify's Web API no longer lets an app read the tracks of someone else's playlist (February 2026), so the list comes from the person: pasted
lines or a CSV file. A track becomes a song only by matching a song already in the library (same artist and title, about the same length); the
rest is listed so it can be found on YouTube.
"""
import re
from dataclasses import dataclass

from app.services.game.matching import normalize


@dataclass
class TrackRef:
    title: str
    artist: str
    duration: float = 0.0  # seconds; 0 = not known


_DROP_WORDS = {"feat", "ft", "featuring", "remaster", "remastered", "mono", "stereo"}  # not "live", "version", "edit", "mix": those are other recordings


def _drop_bracket(m: "re.Match[str]") -> str:
    inner = m.group(1)
    words = set(re.findall(r"[a-z]+", inner.lower()))
    return "" if (words & _DROP_WORDS) or re.match(r"\s*with\b", inner, re.IGNORECASE) else m.group(0)


def _key(text: str) -> str:
    """A title for comparing: lower case, accents and punctuation gone; '(feat. …)', '(Live)', '(2011 Remaster)' and '- Remastered 2020' dropped
    (whole words only: '(Alive)' stays)."""
    text = re.sub(r"\s*[\(\[]([^\)\]]*)[\)\]]", _drop_bracket, text)
    text = re.sub(r"\s+-\s+(?=[^-]*\b(?:remaster\w*|mono|stereo)\b).*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+(?:feat\.?|ft\.?|featuring)\s+.*$", "", text, flags=re.IGNORECASE)  # "Song ft. Someone"
    return normalize(text)


def _inside(small: list[str], big: list[str]) -> bool:
    n = len(small)
    return n > 0 and any(big[i:i + n] == small for i in range(len(big) - n + 1))


def match_tracks(tracks: list[TrackRef], library: list[tuple[int, str, str, float]]) -> dict[int, int]:
    """track index → song id for the tracks that are already in the library. `library` rows: (song id, artist, title, duration; 0 = not known).

    Same title; the track's first artist among the song's artists (or the other way round) as whole words; and, when both lengths are known,
    within 4 s. A track written 'Title - Artist' is tried the other way round when it did not match; a track with no artist matches a title
    that is only in the library once.
    """
    by_title: dict[str, list[tuple[int, list[str], float]]] = {}
    for song_id, artist, title, duration in library:
        by_title.setdefault(_key(title), []).append((song_id, _plain(artist), duration))

    def find(title: str, artist: str, duration: float) -> int | None:
        first = _plain(artist.split(",")[0]) if artist else []
        rows = [r for r in by_title.get(_key(title), []) if not (r[2] > 0 and duration > 0 and abs(r[2] - duration) > 4)]
        if not first:
            return rows[0][0] if len(rows) == 1 else None  # a title alone: only when it is unambiguous
        for song_id, other, _ in rows:
            if other and (_inside(first, other) or _inside(other, first)):
                return song_id
        return None

    out: dict[int, int] = {}
    for index, t in enumerate(tracks):
        found = find(t.title, t.artist, t.duration)
        if found is None and t.artist:
            found = find(t.artist, t.title, t.duration)  # written the other way round
        if found is not None:
            out[index] = found
    return out


def _plain(text: str) -> list[str]:
    """Words of an artist: accents and punctuation gone, any alphabet kept ('Кино' → ['кино'])."""
    import unicodedata

    folded = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.category(c).startswith("M")).lower()
    return re.findall(r"[^\W_]+", folded)
