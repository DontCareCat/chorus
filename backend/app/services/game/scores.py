"""Scoreboards. Only FINISHED games count, and each account counts once per song with its best game.

Per song: that best game of every account. Global: the sum of every account's best scores over all songs.
Only display names and numbers leave the server.
"""
from sqlalchemy.orm import Session

from app.db.models import Game, User
from app.schemas.scores import GlobalScoreRow, SongScoreRow

LIMIT = 50


def _best_per_user_and_song(session: Session, song_id: int | None = None) -> dict[tuple[int, int], Game]:
    q = session.query(Game).filter(Game.finished_at.is_not(None))
    if song_id is not None:
        q = q.filter(Game.song_id == song_id)
    best: dict[tuple[int, int], Game] = {}
    for game in q.order_by(Game.finished_at, Game.id):  # earlier first: on a tie the earlier game keeps the place
        key = (game.user_id, game.song_id)
        if key not in best or game.score > best[key].score:
            best[key] = game
    return best


def song_scores(session: Session, song_id: int, me: User) -> list[SongScoreRow]:
    best = _best_per_user_and_song(session, song_id)
    names = {u.id: u.display_name for u in session.query(User).filter(User.id.in_({k[0] for k in best})).all()}
    ranked = sorted(best.values(), key=lambda g: (-g.score, g.finished_at, g.id))
    return [
        SongScoreRow(
            rank=i, display_name=names[g.user_id], points=g.score, correct=g.correct_count, total=len(g.answers),
            best_multiplier=g.best_multiplier, difficulty=g.difficulty, finished_at=g.finished_at, me=g.user_id == me.id,
        )
        for i, g in enumerate(ranked[:LIMIT], start=1)
    ]


def global_scores(session: Session, me: User) -> list[GlobalScoreRow]:
    totals: dict[int, list[int]] = {}
    first: dict[int, object] = {}
    for (user_id, _song), game in _best_per_user_and_song(session).items():
        totals.setdefault(user_id, [0, 0])
        totals[user_id][0] += game.score
        totals[user_id][1] += 1
        first[user_id] = min(first.get(user_id, game.finished_at), game.finished_at)
    names = {u.id: u.display_name for u in session.query(User).filter(User.id.in_(set(totals))).all()}
    ranked = sorted(totals, key=lambda uid: (-totals[uid][0], first[uid], uid))
    return [
        GlobalScoreRow(rank=i, display_name=names[uid], points=totals[uid][0], songs=totals[uid][1], me=uid == me.id)
        for i, uid in enumerate(ranked[:LIMIT], start=1)
    ]
