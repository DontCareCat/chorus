import logging
import threading
from datetime import datetime, timezone

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import DictionaryEntry, DictionaryExample, GameAnswer, Game, LyricLine, Question, Song, User
from app.db.models.types import utcnow
from app.services.dictionary import srs
from app.services.dictionary.lookup import (
    LookupUnavailable, Translator, Wiktionary, article_for, cached_translation, cached_word_info,
)
from app.services.game.nlp import base_language
from app.services.settings import load_settings

log = logging.getLogger(__name__)
MAX_EXAMPLES = 5
NEW_PER_DAY = 20


def word_key(word: str) -> str:
    return word.strip().casefold()[:100]


def record_asked(session: Session, user_id: int, language: str, question: Question) -> tuple[DictionaryEntry, bool]:
    """Put the word of a question into the user's dictionary (right or wrong) with the line it came from.
    Returns (entry, created). Asking the same word again only adds a new example sentence."""
    lang = base_language(language)
    key = word_key(question.missing_word)
    entry = session.query(DictionaryEntry).filter_by(user_id=user_id, language=lang, word=key).one_or_none()
    created = entry is None
    if created:
        entry = DictionaryEntry(user_id=user_id, language=lang, word=key, surface=question.missing_word.strip()[:100])
        session.add(entry)
        session.flush()
    line = session.get(LyricLine, question.lyric_line_id)
    sentence = (line.text if line is not None else question.sentence).strip()
    have = {(e.song_id, e.sentence) for e in entry.examples}
    if sentence and (question.song_id, sentence) not in have and len(entry.examples) < MAX_EXAMPLES:
        entry.examples.append(DictionaryExample(
            song_id=question.song_id, sentence=sentence, audio_start=question.audio_start, audio_end=question.audio_end))
    session.commit()
    return entry, created


def import_from_games(session: Session, user: User) -> tuple[int, int]:
    """Add the words of everything the user has already answered. Returns (new words, words seen)."""
    rows = (
        session.query(Question, Game.language).join(GameAnswer, GameAnswer.question_id == Question.id)
        .join(Game, Game.id == GameAnswer.game_id).filter(Game.user_id == user.id).order_by(GameAnswer.id).all()
    )
    seen, new = set(), 0
    for question, language in rows:
        entry, created = record_asked(session, user.id, language, question)
        new += created
        seen.add(entry.id)
    return new, len(seen)


# ---------- enrichment (article, translation) ----------
_inflight: set[int] = set()
_inflight_lock = threading.Lock()


def enrich_entry(session: Session, entry: DictionaryEntry, target: str, translator: Translator, wiktionary: Wiktionary) -> None:
    """Fill in lemma, article and translations. Anything that fails leaves the entry 'failed' so a later try can finish it."""
    failed = False
    source = entry.language
    try:
        info = cached_word_info(session, wiktionary, entry.surface, source)
        if info.lemma and info.gender is None:  # an inflected form: the article belongs to its lemma
            entry.lemma = info.lemma
            lemma_info = cached_word_info(session, wiktionary, info.lemma, source)
            entry.article = article_for(source, lemma_info.gender, info.lemma)
        else:
            entry.lemma = None
            entry.article = article_for(source, info.gender, entry.surface)
    except LookupUnavailable as e:
        log.warning("article lookup failed for %r: %s", entry.surface, e)
        failed = True
    if base_language(source) != base_language(target):
        try:
            entry.translation = cached_translation(session, translator, entry.lemma or entry.surface, source, target)[:300]
            entry.translation_language = target
        except LookupUnavailable as e:
            log.warning("translation failed for %r: %s", entry.surface, e)
            failed = True
        for ex in entry.examples:
            if ex.translation is None:
                try:
                    ex.translation = cached_translation(session, translator, ex.sentence, source, target)
                except LookupUnavailable as e:
                    log.warning("sentence translation failed: %s", e)
                    failed = True
                    break
    else:
        entry.translation_language = target  # same language: nothing to translate
    entry.enrich_status = "failed" if failed else "done"
    session.commit()


def enrich_pending(factory: sessionmaker, translator: Translator, wiktionary: Wiktionary, user_id: int, entry_id: int | None = None) -> None:
    """Background task: finish the user's pending entries (or one entry). Opens its own session and never raises."""
    try:
        with factory() as session:
            if not load_settings(session).translation_enabled:
                return
            user = session.get(User, user_id)
            if user is None:
                return
            q = session.query(DictionaryEntry).filter_by(user_id=user_id)
            q = q.filter_by(id=entry_id) if entry_id is not None else q.filter_by(enrich_status="pending")
            for entry in q.order_by(DictionaryEntry.id).all():
                with _inflight_lock:
                    if entry.id in _inflight:
                        continue
                    _inflight.add(entry.id)
                try:
                    enrich_entry(session, entry, user.translation_language, translator, wiktionary)
                except Exception:
                    log.exception("enriching dictionary entry %s failed", entry.id)
                    session.rollback()
                finally:
                    with _inflight_lock:
                        _inflight.discard(entry.id)
    except Exception:
        log.exception("dictionary enrichment failed")


def reset_translations(session: Session, user: User) -> None:
    """The user changed the language they learn in: forget the old translations; they are fetched again in the background."""
    for entry in session.query(DictionaryEntry).filter_by(user_id=user.id):
        entry.translation = None
        entry.translation_language = None
        entry.enrich_status = "pending"
        for ex in entry.examples:
            ex.translation = None
    session.commit()


# ---------- listing and review ----------
def _search(q, text: str):
    like = "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    return q.filter(or_(
        DictionaryEntry.surface.ilike(like, escape="\\"), DictionaryEntry.lemma.ilike(like, escape="\\"),
        DictionaryEntry.translation.ilike(like, escape="\\"),
    ))


def _today_start(now: datetime) -> datetime:
    return now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


def filtered(session: Session, user: User, status: str = "all", language: str | None = None, text: str | None = None, now: datetime | None = None):
    now = now or utcnow()
    q = session.query(DictionaryEntry).filter_by(user_id=user.id)
    if language:
        q = q.filter_by(language=language)
    if text and text.strip():
        q = _search(q, text.strip())
    if status == "suspended":
        q = q.filter(DictionaryEntry.suspended.is_(True))
    elif status == "due":
        q = q.filter(DictionaryEntry.suspended.is_(False), DictionaryEntry.due_at.is_not(None), DictionaryEntry.due_at <= now)
    elif status == "new":
        q = q.filter(DictionaryEntry.suspended.is_(False), DictionaryEntry.due_at.is_(None))
    return q


def language_counts(session: Session, user: User) -> list[tuple[str, int]]:
    rows = session.query(DictionaryEntry.language, func.count()).filter_by(user_id=user.id).group_by(DictionaryEntry.language).all()
    return sorted(((code, n) for code, n in rows), key=lambda r: (-r[1], r[0]))


def new_allowance(session: Session, user: User, now: datetime) -> int:
    introduced = session.query(DictionaryEntry).filter(
        DictionaryEntry.user_id == user.id, DictionaryEntry.introduced_at >= _today_start(now)).count()
    return max(0, NEW_PER_DAY - introduced)


def review_summary(session: Session, user: User, now: datetime | None = None) -> dict[str, int]:
    now = now or utcnow()
    due = filtered(session, user, "due", now=now).count()
    new = min(filtered(session, user, "new", now=now).count(), new_allowance(session, user, now))
    total = session.query(DictionaryEntry).filter_by(user_id=user.id).count()
    return {"due": due, "new": new, "total": total}


def next_card(session: Session, user: User, now: datetime | None = None) -> tuple[DictionaryEntry | None, datetime | None]:
    """The card to show next: the one that has waited longest, else a new one (within the daily limit).
    When there is none, the second value says when the next one is due."""
    now = now or utcnow()
    due = filtered(session, user, "due", now=now).order_by(DictionaryEntry.due_at, DictionaryEntry.id).first()
    if due is not None:
        return due, None
    if new_allowance(session, user, now) > 0:
        new = filtered(session, user, "new", now=now).order_by(DictionaryEntry.added_at, DictionaryEntry.id).first()
        if new is not None:
            return new, None
    later = (
        session.query(func.min(DictionaryEntry.due_at))
        .filter(DictionaryEntry.user_id == user.id, DictionaryEntry.suspended.is_(False), DictionaryEntry.due_at > now).scalar()
    )
    return None, later


def rate(session: Session, entry: DictionaryEntry, rating: str, now: datetime | None = None) -> None:
    srs.review(entry, rating, now or utcnow())
    session.commit()
