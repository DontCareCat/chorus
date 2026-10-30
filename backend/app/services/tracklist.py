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


_DROP_WORDS = {"feat", "ft", "featuring", "remaster", "remastered", "live", "version", "edit", "mono", "stereo", "mix"}


def _drop_bracket(m: "re.Match[str]") -> str:
    inner = m.group(1)
    words = set(re.findall(r"[a-z]+", inner.lower()))
    return "" if (words & _DROP_WORDS) or re.match(r"\s*with\b", inner, re.IGNORECASE) else m.group(0)


def _key(text: str) -> str:
    """A title for comparing: lower case, accents and punctuation gone; '(feat. …)', '(Live)', '(2011 Remaster)' and '- Remastered 2020' dropped
    (whole words only: '(Alive)' stays)."""
    text = re.sub(r"\s*[\(\[]([^\)\]]*)[\)\]]", _drop_bracket, text)
    text = re.sub(r"\s+-\s+(?=[^-]*\b(?:remaster\w*|live|version|edit|mono|stereo)\b).*$", "", text, flags=re.IGNORECASE)
    return normalize(text)


def _inside(small: list[str], big: list[str]) -> bool:
    n = len(small)
    return n > 0 and any(big[i:i + n] == small for i in range(len(big) - n + 1))


def match_tracks(tracks: list[TrackRef], library: list[tuple[int, str, str, float]]) -> dict[int, int]:
    """track index → song id for the tracks that are already in the library. `library` rows: (song id, artist, title, duration; 0 = not known).

    Same title; the track's first artist among the song's artists (or the other way round) as whole words; and, when both lengths are known,
    within 4 s.
    """
    by_title: dict[str, list[tuple[int, list[str], float]]] = {}
    for song_id, artist, title, duration in library:
        by_title.setdefault(_key(title), []).append((song_id, _plain(artist), duration))
    out: dict[int, int] = {}
    for index, t in enumerate(tracks):
        first = _plain(t.artist.split(",")[0]) if t.artist else []
        for song_id, artist, duration in by_title.get(_key(t.title), []):
            if duration > 0 and t.duration > 0 and abs(duration - t.duration) > 4:
                continue
            if first and artist and (_inside(first, artist) or _inside(artist, first)):
                out[index] = song_id
                break
    return out


def _plain(text: str) -> list[str]:
    import unicodedata

    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.findall(r"[a-z0-9]+", folded)
