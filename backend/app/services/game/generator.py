import hashlib
import random
from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import LyricLine, Lyrics, Question, QuestionOption, Song
from app.services.game.distractors import pick_distractors
from app.services.game.nlp import (
    MIN_WORD_LEN, STOPWORD_ZIPF, Token, ensure_supported, normalize_line, tokenize, zipf,
)

# Share of the lyrics' words that become questions, per difficulty.
DIFFICULTY_PERCENT = {"easy": 10, "medium": 30, "hard": 60, "expert": 80}
DIFFICULTIES = tuple(DIFFICULTY_PERCENT)
MAX_QUESTIONS = 500
MIN_LINE_WORDS = 3
BLANK = "____"


@dataclass
class QuestionDraft:
    line: LyricLine
    blank_index: int  # which blank of the line this question asks (0-based, left to right)
    word: str
    sentence: str  # the whole line with ALL of its blanks hidden, so no question reveals another
    options: list[tuple[str, bool]]  # (text, is_correct), already shuffled


def seeded_rng(lyrics_id: int, difficulty: str) -> random.Random:
    digest = hashlib.sha256(f"{lyrics_id}:{difficulty}".encode()).digest()
    return random.Random(int.from_bytes(digest[:8], "big"))


def select_lines(lines: list[LyricLine]) -> list[LyricLine]:
    """Drop short lines and repeated (chorus) lines."""
    seen: set[str] = set()
    out: list[LyricLine] = []
    for line in lines:
        key = normalize_line(line.text)
        if len(tokenize(line.text)) < MIN_LINE_WORDS or key in seen:
            continue
        seen.add(key)
        out.append(line)
    return out


def question_target(total_words: int, difficulty: str) -> int:
    """How many questions a difficulty asks for: its percentage of the lyrics' words (at least one)."""
    return max(1, min(MAX_QUESTIONS, round(total_words * DIFFICULTY_PERCENT[difficulty] / 100)))


def build_drafts(lyrics: Lyrics, language: str, difficulty: str) -> list[QuestionDraft]:
    """Blank a share of the lyrics' words (see DIFFICULTY_PERCENT), spread over the whole song.

    Content words are chosen first; function words ("und", "zu") only once the content words run out
    (the 60% and 80% levels). A word repeated within its line is never blanked and every line keeps at
    least one visible word.
    """
    ensure_supported(language)
    rng = seeded_rng(lyrics.id, difficulty)
    lines = select_lines(list(lyrics.lines))
    vocab = {t.text.lower() for line in lyrics.lines for t in tokenize(line.text)}
    tokens = {line.id: tokenize(line.text) for line in lines}
    total_words = sum(len(t) for t in tokens.values())

    # candidates: (priority, line, token); priority 0 = content word, 1 = function word / short word
    cands: list[tuple[int, LyricLine, Token]] = []
    for line in lines:
        counts: dict[str, int] = {}
        for t in tokens[line.id]:
            counts[t.text.lower()] = counts.get(t.text.lower(), 0) + 1
        for t in tokens[line.id]:
            if counts[t.text.lower()] != 1 or len(t.text) < 2:
                continue
            content = len(t.text) >= MIN_WORD_LEN and zipf(t.text, language) < STOPWORD_ZIPF
            cands.append((0 if content else 1, line, t))
    rng.shuffle(cands)
    cands.sort(key=lambda c: c[0])  # stable: shuffled order is kept within a priority group

    want = question_target(total_words, difficulty)
    per_line: dict[int, list[Token]] = {}
    taken: set[tuple[int, int]] = set()
    chosen = 0
    for priority, line, tok in cands:
        if chosen >= want:
            break
        if len(per_line.get(line.id, [])) >= len(tokens[line.id]) - 1:  # keep one word visible
            continue
        per_line.setdefault(line.id, []).append(tok)
        taken.add((line.id, tok.start))
        chosen += 1

    drafts: list[QuestionDraft] = []
    for line in lines:
        picked = sorted(per_line.get(line.id, []), key=lambda t: t.start)
        if not picked:
            continue
        in_line = {t.text.lower() for t in tokens[line.id]}
        kept: list[tuple[Token, list[str]]] = []
        for tok in picked:
            function_word = len(tok.text) < MIN_WORD_LEN or zipf(tok.text, language) >= STOPWORD_ZIPF
            d = pick_distractors(tok.text, language, vocab, in_line, rng, function_word=function_word)
            if d is not None:
                kept.append((tok, d))
        if not kept:
            continue
        sentence = line.text
        for tok, _ in reversed(kept):  # right to left keeps earlier offsets valid
            sentence = sentence[: tok.start] + BLANK + sentence[tok.end :]
        for i, (tok, d) in enumerate(kept):
            options = [(tok.text, True)] + [(x, False) for x in d]
            rng.shuffle(options)
            drafts.append(QuestionDraft(line, i, tok.text, sentence, options))
    return drafts


def ensure_questions(session: Session, song: Song, lyrics: Lyrics, difficulty: str) -> list[Question]:
    """Questions for (lyrics, difficulty): reuse the stored set, otherwise generate and persist it once."""
    if difficulty not in DIFFICULTIES:
        raise AppError("invalid_difficulty", f"difficulty must be one of {', '.join(DIFFICULTIES)}", 422)

    def stored() -> list[Question]:
        return (
            session.query(Question).filter_by(lyrics_id=lyrics.id, difficulty=difficulty)
            .order_by(Question.lyric_line_id, Question.blank_index).all()
        )

    existing = stored()
    if existing:
        return existing
    drafts = build_drafts(lyrics, song.language, difficulty)
    if not drafts:
        raise AppError("no_questions", "Could not generate questions from these lyrics (too short or too few distinct words)", 422)
    for d in drafts:
        q = Question(
            song_id=song.id, lyrics_id=lyrics.id, lyric_line_id=d.line.id, difficulty=difficulty,
            blank_index=d.blank_index, missing_word=d.word, sentence=d.sentence, audio_start=d.line.start_time, audio_end=d.line.end_time,
        )
        q.options = [QuestionOption(text=t, is_correct=ok, position=i) for i, (t, ok) in enumerate(d.options)]
        session.add(q)
    try:
        session.commit()
    except IntegrityError:  # a concurrent request generated the same set first
        session.rollback()
    return stored()
