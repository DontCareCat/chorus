from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user, get_spotify_client
from app.core.errors import AppError
from app.db.database import get_session
from app.db.models import Song
from app.schemas.song import SpotifyPlaylistOut, SpotifyTrackOut
from app.services.spotify_page import SpotifyPageClient, SpotifyUnavailable, parse_playlist_id, parse_track_id
from app.services.tracklist import match_tracks

router = APIRouter(prefix="/api", tags=["discovery"], dependencies=[Depends(current_user)])


@router.get("/spotify/playlist", response_model=SpotifyPlaylistOut)
def spotify_playlist(
    url: str = Query(min_length=1, max_length=500), session: Session = Depends(get_session), spotify: SpotifyPageClient = Depends(get_spotify_client),
):
    """The tracks of a public Spotify playlist, each with the song in the library it matches (if any). Saves nothing."""
    playlist_id = parse_playlist_id(url)
    if playlist_id is None:
        raise AppError("bad_spotify_link", "That is not a Spotify playlist link", 422)
    try:
        playlist = spotify.playlist(playlist_id)
    except SpotifyUnavailable as e:
        raise AppError("spotify_unreachable", "Spotify could not be reached; try again in a moment", 503) from e
    songs = session.execute(select(Song.id, Song.artist, Song.title, Song.duration).where(Song.removed.is_(False))).all()
    matches = match_tracks(playlist.tracks, [(s.id, s.artist, s.title, s.duration) for s in songs])
    titles = {s.id: s.title for s in songs}
    tracks = [
        SpotifyTrackOut(spotify_id=t.spotify_id, title=t.title, artist=t.artist, duration=t.duration, song_id=matches.get(i), song_title=titles.get(matches.get(i, -1)))
        for i, t in enumerate(playlist.tracks)
    ]
    return SpotifyPlaylistOut(playlist_id=playlist_id, name=playlist.name, owner=playlist.owner, tracks=tracks, matched=len(matches))


@router.get("/spotify/track", response_model=SpotifyTrackOut)
def spotify_track(
    url: str = Query(min_length=1, max_length=500), session: Session = Depends(get_session), spotify: SpotifyPageClient = Depends(get_spotify_client),
):
    """A Spotify song link: its title, artist and length, and the song already in the library that it matches (if any). Saves nothing."""
    track_id = parse_track_id(url)
    if track_id is None:
        raise AppError("bad_spotify_link", "That is not a Spotify song link", 422)
    try:
        t = spotify.track(track_id)
    except SpotifyUnavailable as e:
        raise AppError("spotify_unreachable", "Spotify could not be reached; try again in a moment", 503) from e
    songs = session.execute(select(Song.id, Song.artist, Song.title, Song.duration).where(Song.removed.is_(False))).all()
    found = match_tracks([t], [(s.id, s.artist, s.title, s.duration) for s in songs]).get(0)
    title = next((s.title for s in songs if s.id == found), None) if found is not None else None
    return SpotifyTrackOut(spotify_id=t.spotify_id or track_id, title=t.title, artist=t.artist, duration=t.duration, song_id=found, song_title=title)
