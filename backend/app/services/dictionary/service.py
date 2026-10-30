import logging
import re
import threading
import unicodedata
from datetime import datetime, timezone

from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import DictionaryEntry, DictionaryExample, GameAnswer, Game, LyricLine, Question, Song, User
from app.db.models.types import utcnow
from app.services.dictionary import srs
from app.services.dictionary.lookup import (
    LookupUnavailable, Translator, WordInfo, Wiktionary, article_for, bad_meaning, cached_translation, cached_word_info,
)
from app.services.game.nlp import base_language
from app.services.settings import load_settings

log = logging.getLogger(__name__)
MAX_EXAMPLES = 5
SESSION_SIZES = (20, 40, 60)


def word_key(word: str) -> str:
    """One card per word: composed and decomposed spellings and the apostrophe variants (geh’n, geh'n) are the same key."""
    return unicodedata.normalize("NFC", word).strip().replace("’", "'").replace("ʼ", "'").casefold()[:100]


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


def noun_hint(entry: DictionaryEntry) -> bool | None:
    """True when the word was sung capitalised inside a line (a German noun), False when lowercase, None when it is capitalised
    only as the first word of a line (so it could be any word)."""
    word = entry.surface.strip()
    if not word or not word[0].isupper():
        return False
    for ex in entry.examples:
        tokens = re.findall(r"[\w']+", ex.sentence)
        if word in tokens[1:]:
            return True
    return None


def word_translation(session: Session, translator: Translator, entry: DictionaryEntry, info: WordInfo, source: str, target: str) -> str | None:
    """English: Wiktionary's own definition of the lemma. Otherwise the translation service, asked for the lemma (a bare word in its
    dictionary form, capitalised only for nouns) and never trusted when it only returns punctuation or the same word back."""
    if base_language(target) == "en" and info.gloss:
        return info.gloss[:300]
    word = entry.lemma or entry.surface
    ask = word if info.is_noun or not info.found else word.lower()
    out = cached_translation(session, translator, ask, source, target)[:300]
    if not re.search(r"[^\W\d_]", out) or out.casefold() == ask.casefold():
        return None
    return out


def fallback_meaning(session: Session, translator: Translator, entry: DictionaryEntry, info: WordInfo, source: str, target: str) -> tuple[str, str] | None:
    """A meaning for a word the translation could not give one for (it is already in the translation language, or the service only
    returned the same word): Wiktionary's English definition, else a translation into English. (meaning, its language) or None."""
    if info.gloss:
        return info.gloss[:300], "en"
    if base_language(source) != "en" and base_language(target) != "en":
        word = entry.lemma or entry.surface
        ask = word if info.is_noun or not info.found else word.lower()
        out = cached_translation(session, translator, ask, source, "en")[:300]
        if re.search(r"[^\W\d_]", out) and out.casefold() != ask.casefold():
            return out, "en"
    return None


def enrich_entry(session: Session, entry: DictionaryEntry, target: str, translator: Translator, wiktionary: Wiktionary, fresh: bool = False) -> None:
    """Fill in lemma, article and translations. Anything that fails leaves the entry 'failed' so a later try can finish it."""
    failed = False
    source = entry.language
    info = WordInfo()
    try:
        hint = noun_hint(entry)
        info = cached_word_info(session, wiktionary, entry.surface, source, hint, fresh)
        if info.found and info.lemma and not info.is_noun and hint is None and entry.surface[:1].isupper():
            entry.surface = entry.surface.lower()  # capitalised only because it began the line: the headword is the lowercase word
        lemma = info.lemma if info.lemma and info.lemma.casefold() != entry.surface.casefold() else None
        entry.lemma = lemma
        # only a noun has an article: not the pronoun "mir", the numeral "neun" or the verb "fallen"
        entry.article = article_for(source, info.gender, lemma or entry.surface) if info.is_noun else None
    except LookupUnavailable as e:
        log.warning("article lookup failed for %r: %s", entry.surface, e)
        failed = True
    if base_language(source) != base_language(target):
        try:
            entry.translation = word_translation(session, translator, entry, info, source, target)
            entry.translation_language = target
            if not entry.translation:  # the same word came back: write its meaning down in another way
                meaning = fallback_meaning(session, translator, entry, info, source, target)
                if meaning:
                    entry.translation, entry.translation_language = meaning
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
        entry.translation_language = target  # same language: nothing to translate, but the meaning is still written down
        try:
            meaning = fallback_meaning(session, translator, entry, info, source, target)
        except LookupUnavailable as e:
            log.warning("meaning lookup failed for %r: %s", entry.surface, e)
            failed = True  # looked up again later on its own
            meaning = None
        if meaning:
            entry.translation, entry.translation_language = meaning
    entry.enrich_status = "failed" if failed else "done"
    session.commit()


_running: dict[int, bool] = {}  # users with an enrichment task going -> "more entries arrived while it ran"
_running_lock = threading.Lock()


def enrich_pending(factory: sessionmaker, translator: Translator, wiktionary: Wiktionary, user_id: int, entry_id: int | None = None) -> None:
    """Background task: finish the user's pending entries (or one entry). Opens its own session and never raises.

    Every answer starts one of these. Answering a whole song quickly means dozens at once, and each would sit in a worker thread waiting for
    its turn at the (slow, spaced out) lookup services; with all the threads taken the rest of the server stood still. So only one task per user
    works at a time; the others just note that there is more to do and return, and the running one goes round again before it ends.
    """
    if entry_id is not None:  # "look up again" for one entry: a single, rare request
        _enrich_once(factory, translator, wiktionary, user_id, entry_id)
        return
    with _running_lock:
        if user_id in _running:
            _running[user_id] = True
            return
        _running[user_id] = False
    try:
        while True:
            _enrich_once(factory, translator, wiktionary, user_id, None)
            with _running_lock:
                if not _running[user_id]:
                    del _running[user_id]
                    return
                _running[user_id] = False
    except BaseException:
        with _running_lock:
            _running.pop(user_id, None)
        raise


def requeue_failed(session: Session, user_id: int, now: float | None = None) -> bool:
    """Entries a lookup failed for (offline, busy) are tried again on their own, at most once an hour per user. True when some were queued."""
    import time

    now = time.time() if now is None else now
    if now - _retried.get(user_id, 0.0) < 3600:
        return False
    _retried[user_id] = now
    n = session.query(DictionaryEntry).filter_by(user_id=user_id, enrich_status="failed").update({"enrich_status": "pending"})
    session.commit()
    return n > 0


_retried: dict[int, float] = {}


def _enrich_once(factory: sessionmaker, translator: Translator, wiktionary: Wiktionary, user_id: int, entry_id: int | None) -> None:
    try:
        with _enrich_lock, factory() as session:
            if not load_settings(session).translation_enabled:
                return
            user = session.get(User, user_id)
            if user is None:
                return
            q = session.query(DictionaryEntry).filter_by(user_id=user_id)
            q = q.filter_by(id=entry_id) if entry_id is not None else q.filter_by(enrich_status="pending")
            unreachable = 0
            for entry in q.order_by(DictionaryEntry.id).all():
                if unreachable >= 3:
                    break  # the services do not answer: the rest waits for the next try instead of asking one by one
                try:
                    enrich_entry(session, entry, user.translation_language, translator, wiktionary, fresh=entry_id is not None)
                    unreachable = unreachable + 1 if entry.enrich_status == "failed" else 0
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


def facets(session: Session, user: User, status: str, language: str | None, text: str | None, now: datetime | None = None) -> dict:
    """Counters that agree with the filters: each status chip counts the words the chosen language and search leave, and each
    language chip counts the words the chosen status and search leave (every language of the user keeps its chip, with 0)."""
    now = now or utcnow()
    by_status = {s: filtered(session, user, s, language, text, now=now).count() for s in ("all", "due", "new", "suspended")}
    counts = dict(
        filtered(session, user, status, None, text, now=now).with_entities(DictionaryEntry.language, func.count()).group_by(DictionaryEntry.language).all()
    )
    languages = [(code, counts.get(code, 0)) for code, _ in language_counts(session, user)]
    return {"status": by_status, "languages": languages}


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


# ---------- Anki exchange (see anki.py) ----------

def export_words(session: Session, user: User, status: str, language: str | None, text: str | None) -> list:
    """The words the Dictionary page shows for these filters (oldest first), ready for a deck or a list."""
    from app.services.dictionary import anki

    from sqlalchemy.orm import selectinload

    entries = filtered(session, user, status, language, text).options(selectinload(DictionaryEntry.examples)).order_by(
        DictionaryEntry.added_at, DictionaryEntry.id).all()
    song_ids = {ex.song_id for e in entries for ex in e.examples}
    songs: dict[int, str] = {sid: title for sid, title in session.query(Song.id, Song.title).filter(Song.id.in_(song_ids)).all()} if song_ids else {}
    out = []
    for e in entries:
        examples, seen = [], set()
        for ex in e.examples:
            if sentence_key(ex.sentence) in seen or len(examples) >= 3:
                continue
            seen.add(sentence_key(ex.sentence))
            examples.append((ex.sentence, ex.translation, songs.get(ex.song_id, "")))
        out.append(anki.ExportWord(
            language=e.language, word=e.word, surface=e.surface, article=e.article, translation=e.translation, examples=examples,
            due_at=e.due_at, interval_seconds=e.interval_seconds, reps=e.reps, lapses=e.lapses, suspended=e.suspended, user_id=user.id,
        ))
    return out


def import_notes(session: Session, user: User, notes: list, language: str, with_schedule: bool, translation_language: str | None) -> dict:
    """Words from a deck or list into the dictionary: new words are added (translation kept, the look-ups fill what is missing), words the
    dictionary already has stay as they are (a missing translation is filled). Returns the counts."""
    from app.services.dictionary import anki

    lang = base_language(language)
    now = utcnow()
    added = existing = skipped = 0
    seen: set[tuple[str, str]] = set()
    known = {e.language for e in session.query(DictionaryEntry.language).filter_by(user_id=user.id).distinct()}
    cache: dict[str, dict[str, DictionaryEntry]] = {}
    for n in notes:
        # a note tagged with a language Chorus wrote (or the user already has) keeps it; the chosen language is the fallback
        tagged = next((base_language(t) for t in n.tags if t.lower() != "chorus" and re.fullmatch(r"[a-z]{2,3}(-[A-Za-z]+)?", t) and base_language(t) in known | {lang}), None)
        note_lang = tagged or lang
        article, headword = anki.split_article(n.front, note_lang)
        key = word_key(headword)
        if not key or len(headword) > 100 or (note_lang, key) in seen:
            skipped += 1
            continue
        seen.add((note_lang, key))
        if note_lang not in cache:
            cache[note_lang] = {e.word: e for e in session.query(DictionaryEntry).filter_by(user_id=user.id, language=note_lang)}
        translation = (n.back.split("\n")[0].strip()[:300]) if n.back else ""
        if bad_meaning(translation):
            translation = ""  # an exported ")" is looked up again instead
        entry = cache[note_lang].get(key)
        if entry is not None:
            if translation and not entry.translation:
                entry.translation, entry.translation_language = translation, translation_language
            existing += 1
            continue
        entry = DictionaryEntry(user_id=user.id, language=note_lang, word=key, surface=headword[:100], article=article)
        if translation and not bad_meaning(translation):
            entry.translation, entry.translation_language, entry.enrich_status = translation, translation_language, "done"
        if with_schedule and n.reps > 0 and n.due_at is not None:
            entry.interval_seconds, entry.due_at, entry.reps, entry.lapses = n.interval_seconds, n.due_at, n.reps, n.lapses
            entry.introduced_at = entry.last_reviewed_at = now
        entry.suspended = bool(with_schedule and n.suspended)
        session.add(entry)
        added += 1
    session.commit()
    return {"added": added, "existing": existing, "skipped": skipped}
