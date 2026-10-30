from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user, get_spotify_client
from app.core.errors import AppError
from app.db.database import get_session
from app.db.models import Song
from app.schemas.song import SpotifyPlaylistOut, SpotifyTrackOut
from app.services.settings import load_settings
from app.services.spotify import SpotifyClient, SpotifyUnavailable, match_tracks, parse_playlist_id

router = APIRouter(prefix="/api/spotify", tags=["spotify"], dependencies=[Depends(current_user)])


@router.get("/playlist", response_model=SpotifyPlaylistOut)
def read_playlist(
    url: str = Query(min_length=1, max_length=500), session: Session = Depends(get_session), spotify: SpotifyClient = Depends(get_spotify_client),
):
    """The tracks of a public Spotify playlist, each with the song in the library it matches (if any). Saves nothing."""
    playlist_id = parse_playlist_id(url)
    if playlist_id is None:
        raise AppError("bad_spotify_link", "That is not a Spotify playlist link", 422)
    cfg = load_settings(session)
    try:
        playlist = spotify.playlist(playlist_id, cfg.spotify_client_id, cfg.spotify_client_secret)
    except SpotifyUnavailable as e:
        raise AppError("spotify_unreachable", "Spotify could not be reached; try again in a moment", 503) from e
    songs = session.execute(select(Song.id, Song.artist, Song.title, Song.duration).where(Song.removed.is_(False))).all()
    matches = match_tracks(playlist.tracks, [(s.id, s.artist, s.title, s.duration) for s in songs])
    titles = {s.id: s.title for s in songs}
    tracks = [
        SpotifyTrackOut(
            spotify_id=t.spotify_id, title=t.title, artist=t.artist, album=t.album, duration=t.duration,
            song_id=matches.get(t.spotify_id), song_title=titles.get(matches.get(t.spotify_id, -1)),
        )
        for t in playlist.tracks
    ]
    return SpotifyPlaylistOut(playlist_id=playlist_id, name=playlist.name, total=playlist.total, tracks=tracks, matched=len(matches))
