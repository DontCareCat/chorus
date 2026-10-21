import logging
import threading
from datetime import datetime, timezone

from sqlalchemy import case, func, or_
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
SESSION_SIZES = (20, 40, 60)


def word_key(word: str) -> str:
    return word.strip().casefold()[:100]


def sentence_key(text: str) -> str:
    """Two lines that differ only in case, spacing or punctuation are the same sentence (a chorus repeated in another song or edit)."""
    return " ".join("".join(c if c.isalnum() else " " for c in text.casefold()).split())


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
    have = {sentence_key(e.sentence) for e in entry.examples}
    if sentence and sentence_key(sentence) not in have and len(entry.examples) < MAX_EXAMPLES:
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
_enrich_lock = threading.Lock()  # one enrichment at a time: every answer starts a task, and they would all ask for the same words


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
    """Background task: finish the user's pending entries (or one entry). Opens its own session and never raises.
    Tasks started by later answers wait their turn and then find nothing left to do."""
    try:
        with _enrich_lock, factory() as session:
            if not load_settings(session).translation_enabled:
                return
            user = session.get(User, user_id)
            if user is None:
                return
            q = session.query(DictionaryEntry).filter_by(user_id=user_id)
            q = q.filter_by(id=entry_id) if entry_id is not None else q.filter_by(enrich_status="pending")
            for entry in q.order_by(DictionaryEntry.id).all():
                try:
                    enrich_entry(session, entry, user.translation_language, translator, wiktionary)
                except Exception:
                    log.exception("enriching dictionary entry %s failed", entry.id)
                    session.rollback()
                    entry.enrich_status = "failed"  # a later "look up again" can finish it
                    session.commit()
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


def reviewed_today(session: Session, user: User, now: datetime) -> int:
    """Cards reviewed since midnight UTC (a card reviewed twice today counts once)."""
    start = now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return session.query(DictionaryEntry).filter(DictionaryEntry.user_id == user.id, DictionaryEntry.last_reviewed_at >= start).count()


def left_today(session: Session, user: User, now: datetime) -> int | None:
    if not user.daily_card_limit:
        return None
    return max(0, user.daily_card_limit - reviewed_today(session, user, now))


def review_summary(
    session: Session, user: User, now: datetime | None = None, status: str = "all", language: str | None = None, text: str | None = None,
) -> dict[str, int]:
    """Counts for the words the review would use: all of the user's words, or only those the Dictionary page's filters show."""
    now = now or utcnow()
    scope = filtered(session, user, status, language, text, now=now)
    return {
        "due": filtered(session, user, "due", language, text, now=now).count() if status in ("all", "due") else 0,
        "new": filtered(session, user, "new", language, text, now=now).count() if status in ("all", "new") else 0,  # the same words the New filter lists
        "total": scope.count(),
        "available": scope.filter(DictionaryEntry.suspended.is_(False)).count(),
        "reviewed_today": reviewed_today(session, user, now),
        "left_today": left_today(session, user, now),
    }


def next_card(
    session: Session, user: User, exclude: list[int] | None = None, now: datetime | None = None,
    status: str = "all", language: str | None = None, text: str | None = None,
) -> DictionaryEntry | None:
    """The next card of a review session. A session always has cards, whether or not their time has come:
    overdue cards first (longest overdue first), then new words (oldest first), then the ones due soonest.
    `exclude` are the cards this session already showed; status / language / text narrow it to the words the
    Dictionary page's filters show. None when every card was shown or the daily limit is reached."""
    now = now or utcnow()
    if left_today(session, user, now) == 0:  # the daily limit is used up
        return None
    group = case((DictionaryEntry.due_at.is_(None), 1), (DictionaryEntry.due_at <= now, 0), else_=2)
    q = filtered(session, user, status, language, text, now=now).filter(DictionaryEntry.suspended.is_(False))
    if exclude:
        q = q.filter(DictionaryEntry.id.not_in(exclude))
    return q.order_by(group, DictionaryEntry.due_at, DictionaryEntry.added_at, DictionaryEntry.id).first()


SCHEDULE_FIELDS = ("due_at", "interval_seconds", "reps", "lapses", "introduced_at", "last_reviewed_at")


def schedule_of(entry: DictionaryEntry) -> dict:
    return {f: getattr(entry, f) for f in SCHEDULE_FIELDS}


def rate(session: Session, entry: DictionaryEntry, rating: str, now: datetime | None = None) -> dict:
    """Apply a rating. Returns the schedule it replaced (so the rating can be taken back)."""
    before = schedule_of(entry)
    srs.review(entry, rating, now or utcnow())
    session.commit()
    return before


def restore(session: Session, entry: DictionaryEntry, state: dict) -> None:
    """Put an earlier schedule back: "Back" after a misclicked rating."""
    for f in SCHEDULE_FIELDS:
        setattr(entry, f, state[f])
    session.commit()
