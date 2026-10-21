from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import current_user, get_session_factory, get_translator, get_wiktionary
from app.core.errors import AppError
from app.db.database import get_session
from app.db.models import DictionaryEntry, Song, User
from app.schemas.dictionary import (
    EntryList, EntryOut, EntryPatch, ExampleOut, ImportResult, Intervals, LanguageCount, RatedOut, RatingIn, ReviewFront,
    ReviewNext, ReviewSummary, ScheduleState,
)
from app.services.dictionary import service, srs
from app.services.dictionary.service import sentence_key
from app.services.dictionary.lookup import Translator, Wiktionary

router = APIRouter(prefix="/api/dictionary", tags=["dictionary"], dependencies=[Depends(current_user)])


def entry_out(session: Session, entry: DictionaryEntry) -> EntryOut:
    songs = {s.id: s for s in session.query(Song).filter(Song.id.in_({e.song_id for e in entry.examples})).all()} if entry.examples else {}
    examples = []
    seen: set[str] = set()
    for ex in entry.examples:
        if sentence_key(ex.sentence) in seen:
            continue  # entries saved before duplicates were refused
        seen.add(sentence_key(ex.sentence))
        song = songs.get(ex.song_id)
        ok = song is not None and not song.removed and song.available and ex.audio_start is not None
        offset = song.lyrics_offset if song else 0.0
        examples.append(ExampleOut(
            id=ex.id, song_id=ex.song_id, song_title=song.title if song else "", sentence=ex.sentence, translation=ex.translation,
            audio_start=ex.audio_start + offset if ex.audio_start is not None else None,
            audio_end=ex.audio_end + offset if ex.audio_end is not None else None, playable=bool(ok),
        ))
    return EntryOut(
        id=entry.id, language=entry.language, surface=entry.surface, lemma=entry.lemma, article=entry.article,
        translation=entry.translation, translation_language=entry.translation_language, enrich_status=entry.enrich_status,
        suspended=entry.suspended, added_at=entry.added_at, due_at=entry.due_at, interval_seconds=entry.interval_seconds,
        reps=entry.reps, lapses=entry.lapses, examples=examples,
    )


def _own(session: Session, entry_id: int, user: User) -> DictionaryEntry:
    entry = session.get(DictionaryEntry, entry_id)
    if entry is None or entry.user_id != user.id:
        raise AppError("word_not_found", "Word not found", 404)
    return entry


@router.get("", response_model=EntryList)
def list_entries(
    background: BackgroundTasks,
    status: str = Query("all", pattern="^(all|due|new|suspended)$"), language: str | None = None, q: str | None = None,
    limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0),
    session: Session = Depends(get_session), user: User = Depends(current_user),
    factory: sessionmaker = Depends(get_session_factory), translator: Translator = Depends(get_translator),
    wiktionary: Wiktionary = Depends(get_wiktionary),
):
    if offset == 0 and session.query(DictionaryEntry.id).filter_by(user_id=user.id, enrich_status="pending").first() is not None:
        background.add_task(service.enrich_pending, factory, translator, wiktionary, user.id)  # e.g. after an update that redoes the lookups
    query = service.filtered(session, user, status, language, q)
    total = query.count()
    rows = query.order_by(DictionaryEntry.added_at.desc(), DictionaryEntry.id.desc()).offset(offset).limit(limit).all()
    return EntryList(
        total=total, items=[entry_out(session, e) for e in rows],
        languages=[LanguageCount(code=c, count=n) for c, n in service.language_counts(session, user)],
    )


@router.post("/import-from-games", response_model=ImportResult)
def import_from_games(
    background: BackgroundTasks, session: Session = Depends(get_session), user: User = Depends(current_user),
    factory: sessionmaker = Depends(get_session_factory), translator: Translator = Depends(get_translator),
    wiktionary: Wiktionary = Depends(get_wiktionary),
):
    added, words = service.import_from_games(session, user)
    background.add_task(service.enrich_pending, factory, translator, wiktionary, user.id)
    return ImportResult(added=added, words=words)


class Scope:
    """The Dictionary page's filters, so a review can be limited to the words that page shows."""

    def __init__(self, status: str = Query("all", pattern="^(all|due|new|suspended)$"), language: str | None = Query(None, max_length=16),
                 q: str | None = Query(None, max_length=200)):
        self.status, self.language, self.q = status, language, q


# review routes come before /{entry_id}
@router.get("/review/summary", response_model=ReviewSummary)
def review_summary(scope: Scope = Depends(), session: Session = Depends(get_session), user: User = Depends(current_user)):
    return ReviewSummary(**service.review_summary(session, user, None, scope.status, scope.language, scope.q))


@router.get("/review/next", response_model=ReviewNext)
def review_next(
    exclude: str = Query("", pattern=r"^(\d+(,\d+)*)?$", max_length=1000), scope: Scope = Depends(), session: Session = Depends(get_session), user: User = Depends(current_user),
):
    """The next card of a review session (`exclude`: ids of the cards it already showed; status / language / q: only the
    words the Dictionary page's filters show). It is the closest-to-due card even when its time has not come yet;
    no card means every word has been shown."""
    entry = service.next_card(session, user, [int(x) for x in exclude.split(",") if x], None, scope.status, scope.language, scope.q)
    card = ReviewFront(id=entry.id, word=entry.surface, language=entry.language,
                       intervals=Intervals(**srs.intervals(entry.interval_seconds))) if entry else None
    return ReviewNext(card=card, summary=ReviewSummary(**service.review_summary(session, user, None, scope.status, scope.language, scope.q)))


@router.post("/review/{entry_id}/answer", response_model=RatedOut)
def review_answer(entry_id: int, body: RatingIn, session: Session = Depends(get_session), user: User = Depends(current_user)):
    """Store how hard it was; the answer is the back of the card: article, translation and the sentences, plus the
    schedule the rating replaced (send it to `/undo` to take the rating back)."""
    entry = _own(session, entry_id, user)
    previous = service.rate(session, entry, body.rating)
    return RatedOut(**entry_out(session, entry).model_dump(), previous=ScheduleState(**previous))


@router.post("/review/{entry_id}/undo", response_model=EntryOut)
def review_undo(entry_id: int, body: ScheduleState, session: Session = Depends(get_session), user: User = Depends(current_user)):
    """Back: put the schedule from before the last rating back, so the card can be rated again."""
    entry = _own(session, entry_id, user)
    service.restore(session, entry, body.model_dump())
    return entry_out(session, entry)


@router.get("/{entry_id}", response_model=EntryOut)
def read_entry(entry_id: int, session: Session = Depends(get_session), user: User = Depends(current_user)):
    return entry_out(session, _own(session, entry_id, user))


@router.patch("/{entry_id}", response_model=EntryOut)
def patch_entry(entry_id: int, body: EntryPatch, session: Session = Depends(get_session), user: User = Depends(current_user)):
    entry = _own(session, entry_id, user)
    entry.suspended = body.suspended
    session.commit()
    return entry_out(session, entry)


@router.delete("/{entry_id}")
def delete_entry(entry_id: int, session: Session = Depends(get_session), user: User = Depends(current_user)):
    session.delete(_own(session, entry_id, user))
    session.commit()
    return {"deleted": 1}


@router.post("/{entry_id}/refresh", response_model=EntryOut)
def refresh_entry(
    entry_id: int, background: BackgroundTasks, session: Session = Depends(get_session), user: User = Depends(current_user),
    factory: sessionmaker = Depends(get_session_factory), translator: Translator = Depends(get_translator),
    wiktionary: Wiktionary = Depends(get_wiktionary),
):
    """Look the word up again (after a failure, or to pick up a corrected Wiktionary entry)."""
    entry = _own(session, entry_id, user)
    entry.enrich_status = "pending"
    session.commit()
    background.add_task(service.enrich_pending, factory, translator, wiktionary, user.id, entry.id)
    return entry_out(session, entry)
