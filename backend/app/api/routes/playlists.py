from fastapi import APIRouter, Depends
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.errors import AppError
from app.db.database import get_session
from app.db.models import Game, Playlist, PlaylistSong, Song, User
from app.db.models.types import utcnow
from app.schemas.playlist import PlaylistCover, PlaylistIn, PlaylistOut, PlaylistSongOut, PlaylistSummary, SongIds

router = APIRouter(prefix="/api/playlists", tags=["playlists"], dependencies=[Depends(current_user)])


def _mine(session: Session, me: User, playlist_id: int) -> Playlist:
    p = session.get(Playlist, playlist_id)
    if p is None or p.user_id != me.id:
        raise AppError("playlist_not_found", "That playlist does not exist.", 404)  # also for other people's lists
    return p


def _rows(session: Session, playlist_id: int) -> list[tuple[PlaylistSong, Song]]:
    return list(session.execute(
        select(PlaylistSong, Song).join(Song, Song.id == PlaylistSong.song_id)
        .where(PlaylistSong.playlist_id == playlist_id).order_by(PlaylistSong.position)
    ).all())


def _summary(session: Session, p: Playlist) -> PlaylistSummary:
    rows = _rows(session, p.id)
    live = [s for _, s in rows if not s.removed]
    return PlaylistSummary(
        id=p.id, name=p.name, song_count=len(rows), duration=sum(s.duration for s in live),
        covers=[PlaylistCover(id=s.id, title=s.title, has_cover=s.has_cover) for s in live[:4]],
        song_ids=[s.id for _, s in rows], updated_at=p.updated_at,
    )


def _touch(session: Session, p: Playlist) -> None:
    p.updated_at = utcnow()
    session.commit()


def _name(name: str) -> str:
    name = " ".join(name.split())
    if not name:
        raise AppError("invalid_name", "Give the playlist a name.", 422)
    return name


@router.get("", response_model=list[PlaylistSummary])
def list_playlists(session: Session = Depends(get_session), me: User = Depends(current_user)):
    lists = session.scalars(select(Playlist).where(Playlist.user_id == me.id).order_by(func.lower(Playlist.name)))
    return [_summary(session, p) for p in lists]


@router.post("", response_model=PlaylistSummary, status_code=201)
def create_playlist(body: PlaylistIn, session: Session = Depends(get_session), me: User = Depends(current_user)):
    p = Playlist(user_id=me.id, name=_name(body.name))
    session.add(p)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise AppError("playlist_exists", "You already have a playlist with that name.", 409)
    return _summary(session, p)


@router.get("/{playlist_id}", response_model=PlaylistOut)
def get_playlist(playlist_id: int, session: Session = Depends(get_session), me: User = Depends(current_user)):
    p = _mine(session, me, playlist_id)
    rows = _rows(session, p.id)
    stats = {
        r.song_id: r for r in session.execute(
            select(Game.song_id, func.max(Game.score).label("best"), func.count(Game.id).label("n"), func.max(Game.finished_at).label("last"))
            .where(Game.user_id == me.id, Game.finished_at.is_not(None), Game.song_id.in_([s.id for _, s in rows]))
            .group_by(Game.song_id)
        )
    }
    songs = []
    for _, s in rows:
        r = stats.get(s.id)
        s.best_score, s.plays, s.last_played_at, s.lyrics_stalled = (r.best, r.n, r.last, False) if r else (None, 0, None, False)
        songs.append(PlaylistSongOut.model_validate(s, from_attributes=True).model_copy(update={"removed": s.removed}))
    return PlaylistOut(id=p.id, name=p.name, song_count=len(rows), duration=sum(s.duration for _, s in rows if not s.removed), songs=songs)


@router.patch("/{playlist_id}", response_model=PlaylistSummary)
def rename_playlist(playlist_id: int, body: PlaylistIn, session: Session = Depends(get_session), me: User = Depends(current_user)):
    p = _mine(session, me, playlist_id)
    p.name = _name(body.name)
    p.updated_at = utcnow()
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise AppError("playlist_exists", "You already have a playlist with that name.", 409)
    return _summary(session, p)


@router.delete("/{playlist_id}", status_code=204)
def delete_playlist(playlist_id: int, session: Session = Depends(get_session), me: User = Depends(current_user)):
    p = _mine(session, me, playlist_id)
    session.execute(delete(PlaylistSong).where(PlaylistSong.playlist_id == p.id))
    session.delete(p)
    session.commit()


@router.post("/{playlist_id}/songs", response_model=PlaylistSummary)
def add_songs(playlist_id: int, body: SongIds, session: Session = Depends(get_session), me: User = Depends(current_user)):
    """Appends songs that are not in the list yet (in the order given); unknown or removed songs are ignored."""
    p = _mine(session, me, playlist_id)
    have = {sid for sid, in session.execute(select(PlaylistSong.song_id).where(PlaylistSong.playlist_id == p.id))}
    end = session.scalar(select(func.coalesce(func.max(PlaylistSong.position), -1)).where(PlaylistSong.playlist_id == p.id)) + 1
    valid = set(session.scalars(select(Song.id).where(Song.id.in_(body.song_ids), Song.removed.is_(False))))
    for sid in dict.fromkeys(body.song_ids):
        if sid in valid and sid not in have:
            session.add(PlaylistSong(playlist_id=p.id, song_id=sid, position=end))
            end += 1
    _touch(session, p)
    return _summary(session, p)


@router.delete("/{playlist_id}/songs/{song_id}", response_model=PlaylistSummary)
def remove_song(playlist_id: int, song_id: int, session: Session = Depends(get_session), me: User = Depends(current_user)):
    p = _mine(session, me, playlist_id)
    session.execute(delete(PlaylistSong).where(PlaylistSong.playlist_id == p.id, PlaylistSong.song_id == song_id))
    for i, (ps, _) in enumerate(_rows(session, p.id)):  # close the gap
        ps.position = i
    _touch(session, p)
    return _summary(session, p)


@router.put("/{playlist_id}/order", response_model=PlaylistSummary)
def reorder(playlist_id: int, body: SongIds, session: Session = Depends(get_session), me: User = Depends(current_user)):
    """The full list of the playlist's song ids in the new order."""
    p = _mine(session, me, playlist_id)
    rows = {ps.song_id: ps for ps, _ in _rows(session, p.id)}
    if len(body.song_ids) != len(set(body.song_ids)) or set(body.song_ids) != set(rows):
        raise AppError("order_mismatch", "The new order must list every song of the playlist exactly once.", 422)
    for i, sid in enumerate(body.song_ids):
        rows[sid].position = i
    _touch(session, p)
    return _summary(session, p)
