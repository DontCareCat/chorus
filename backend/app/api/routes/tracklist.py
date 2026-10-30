from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.db.database import get_session
from app.db.models import Song
from app.schemas.song import TrackMatch, TrackMatchOut, TrackMatchRequest
from app.services.tracklist import TrackRef, match_tracks

router = APIRouter(prefix="/api/tracks", tags=["tracks"], dependencies=[Depends(current_user)])


@router.post("/match", response_model=TrackMatchOut)
def match(body: TrackMatchRequest, session: Session = Depends(get_session)):
    """Which of these tracks (a playlist the person pasted or exported) are songs in the library. Saves nothing."""
    songs = session.execute(select(Song.id, Song.artist, Song.title, Song.duration).where(Song.removed.is_(False))).all()
    found = match_tracks([TrackRef(t.title, t.artist, t.duration) for t in body.tracks], [(s.id, s.artist, s.title, s.duration) for s in songs])
    titles = {s.id: s.title for s in songs}
    return TrackMatchOut(matches=[TrackMatch(index=i, song_id=sid, song_title=titles[sid]) for i, sid in sorted(found.items())])
