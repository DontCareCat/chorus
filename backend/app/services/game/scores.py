"""Scoreboards. Only FINISHED games count, and each account counts once per song with its best game.

Per song: that best game of every account. Global: the sum of every account's best scores over all songs.
The two game modes (choose / type) have separate boards: their points are not comparable.
Only display names and numbers leave the server.
"""
from sqlalchemy.orm import Session

from app.db.models import Game, Song, User
from app.schemas.scores import GlobalBoard, GlobalScoreRow, MyOverall, MyScoreRow, MyScores, SongBoard, SongScoreRow

LIMIT = 50


def _best_per_user_and_song(session: Session, mode: str, song_id: int | None = None) -> dict[tuple[int, int], Game]:
    q = session.query(Game).filter(Game.finished_at.is_not(None), Game.mode == mode)
    if song_id is not None:
        q = q.filter(Game.song_id == song_id)
    best: dict[tuple[int, int], Game] = {}
    for game in q.order_by(Game.finished_at, Game.id):  # earlier first: on a tie the earlier game keeps the place
        key = (game.user_id, game.song_id)
        if key not in best or game.score > best[key].score:
            best[key] = game
    return best


def _song_rows(session: Session, song_id: int, me: User, mode: str) -> list[SongScoreRow]:
    best = _best_per_user_and_song(session, mode, song_id)
    names = {u.id: u.display_name for u in session.query(User).filter(User.id.in_({k[0] for k in best})).all()}
    ranked = sorted(best.values(), key=lambda g: (-g.score, g.finished_at, g.id))
    return [
        SongScoreRow(
            rank=i, display_name=names[g.user_id], points=g.score, correct=g.correct_count, total=len(g.answers),
            best_multiplier=g.best_multiplier, difficulty=g.difficulty, mode=g.mode, finished_at=g.finished_at, me=g.user_id == me.id,
        )
        for i, g in enumerate(ranked, start=1)
    ]


def song_scores(session: Session, song_id: int, me: User, mode: str = "choice") -> list[SongScoreRow]:
    return _song_rows(session, song_id, me, mode)[:LIMIT]


def song_board(session: Session, song_id: int, me: User, mode: str, limit: int) -> SongBoard:
    """The top `limit` rows; the caller's own row (with their real rank) too when it is below the top."""
    rows = _song_rows(session, song_id, me, mode)
    top = rows[:limit]
    mine = next((r for r in rows if r.me), None)
    return SongBoard(rows=top, me=mine if mine is not None and mine.rank > limit else None, players=len(rows))


def _global_rows(session: Session, me: User, mode: str) -> list[GlobalScoreRow]:
    totals: dict[int, list[int]] = {}
    first: dict[int, object] = {}
    for (user_id, _song), game in _best_per_user_and_song(session, mode).items():
        totals.setdefault(user_id, [0, 0])
        totals[user_id][0] += game.score
        totals[user_id][1] += 1
        first[user_id] = min(first.get(user_id, game.finished_at), game.finished_at)
    names = {u.id: u.display_name for u in session.query(User).filter(User.id.in_(set(totals))).all()}
    ranked = sorted(totals, key=lambda uid: (-totals[uid][0], first[uid], uid))
    return [
        GlobalScoreRow(rank=i, display_name=names[uid], points=totals[uid][0], songs=totals[uid][1], me=uid == me.id)
        for i, uid in enumerate(ranked, start=1)
    ]


def global_scores(session: Session, me: User, mode: str = "choice") -> list[GlobalScoreRow]:
    return _global_rows(session, me, mode)[:LIMIT]


def global_board(session: Session, me: User, mode: str, limit: int) -> GlobalBoard:
    rows = _global_rows(session, me, mode)
    mine = next((r for r in rows if r.me), None)
    return GlobalBoard(rows=rows[:limit], me=mine if mine is not None and mine.rank > limit else None, players=len(rows))


def my_scores(session: Session, me: User, mode: str = "choice") -> MyScores:
    """Every song the caller finished in this mode (newest finished game first) with their best points and place among that song's players,
    and their overall total and place. Hidden library songs stay in (their results are still the player's)."""
    best = _best_per_user_and_song(session, mode)
    by_song: dict[int, list[Game]] = {}
    for (_uid, sid), game in best.items():
        by_song.setdefault(sid, []).append(game)
    mine = [(sid, next((g for g in games if g.user_id == me.id), None)) for sid, games in by_song.items()]
    mine = [(sid, g) for sid, g in mine if g is not None]
    songs = {s.id: s for s in session.query(Song).filter(Song.id.in_({sid for sid, _ in mine})).all()} if mine else {}
    latest: dict[int, object] = {}
    for g in session.query(Game).filter(Game.user_id == me.id, Game.mode == mode, Game.finished_at.is_not(None)).order_by(Game.finished_at, Game.id):
        latest[g.song_id] = g.finished_at
    rows: list[MyScoreRow] = []
    for sid, g in mine:
        song = songs.get(sid)
        if song is None:
            continue
        ranked = sorted(by_song[sid], key=lambda x: (-x.score, x.finished_at, x.id))
        rank = next(i for i, x in enumerate(ranked, start=1) if x.user_id == me.id)
        rows.append(MyScoreRow(
            song_id=sid, title=song.title, artist=song.artist, has_cover=song.has_cover, youtube_id=song.youtube_id, removed=bool(song.removed),
            points=g.score, rank=rank, players=len(ranked), last_finished_at=latest.get(sid, g.finished_at),
        ))
    rows.sort(key=lambda r: r.last_finished_at, reverse=True)
    board = _global_rows(session, me, mode)
    mine_overall = next((r for r in board if r.me), None)
    overall = MyOverall(points=mine_overall.points, rank=mine_overall.rank, players=len(board), songs=mine_overall.songs) if mine_overall else None
    return MyScores(songs=rows, overall=overall)
