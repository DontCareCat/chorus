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
# Typing mode asks for fewer words (each one is typed out): its own shares per level.
TYPING_PERCENT = {"easy": 10, "medium": 25, "hard": 40, "expert": 60}
MODES = ("choice", "typing")
MAX_QUESTIONS = 500
GENERATOR_VERSION = 2  # 1: repeated lines dropped, random spread; 2: repeats kept, even spread
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


def line_key(line: LyricLine) -> str:
    return normalize_line(line.text)


def select_lines(lines: list[LyricLine]) -> list[LyricLine]:
    """Drop lines that are too short to ask about. Repeated (chorus) lines are KEPT: the second half of a song is often
    mostly repeats, and dropping them left it without questions. A repeat only ever blanks words its earlier
    occurrences did not (see `pick_blanks`)."""
    return [line for line in lines if len(tokenize(line.text)) >= MIN_LINE_WORDS]


def unique_word_count(lines: list[LyricLine]) -> int:
    """Words of the lyrics counting each distinct line once: the base of the difficulty percentages."""
    seen: set[str] = set()
    total = 0
    for line in lines:
        key = line_key(line)
        if key not in seen:
            seen.add(key)
            total += len(tokenize(line.text))
    return total


def question_difficulty(mode: str, difficulty: str) -> str:
    """The key a question set is stored under: typing sets sit beside the choice sets under their own key."""
    return f"type-{difficulty}" if mode == "typing" else difficulty


def question_target(total_words: int, difficulty: str, mode: str = "choice") -> int:
    """How many questions a difficulty asks for: its percentage of the lyrics' words (at least one)."""
    percent = TYPING_PERCENT if mode == "typing" else DIFFICULTY_PERCENT
    return max(1, min(MAX_QUESTIONS, round(total_words * percent[difficulty] / 100)))


def pick_blanks(
    lines: list[LyricLine], tokens: dict[int, list[Token]], language: str, want: int, rng: random.Random,
) -> dict[int, list[Token]]:
    """Choose `want` words to blank, spread EVENLY over the song.

    Lines are walked in time order and each gets its share of the questions by even accumulation (a line with
    more usable words gets proportionally more), so ten questions over fifty lines land on every fifth line instead
    of wherever a shuffle put them. Content words are used up before function words. Words inside a line are chosen
    by the seeded RNG. A repeated line only blanks words that its earlier occurrences did not.
    """
    keys = {line.id: line_key(line) for line in lines}
    eligible: dict[int, tuple[list[Token], list[Token]]] = {}
    for line in lines:
        counts: dict[str, int] = {}
        for t in tokens[line.id]:
            counts[t.text.lower()] = counts.get(t.text.lower(), 0) + 1
        content: list[Token] = []
        function: list[Token] = []
        for t in tokens[line.id]:
            if counts[t.text.lower()] != 1 or len(t.text) < 2:
                continue
            is_content = len(t.text) >= MIN_WORD_LEN and zipf(t.text, language) < STOPWORD_ZIPF
            (content if is_content else function).append(t)
        eligible[line.id] = (content, function)

    chosen: dict[int, list[Token]] = {}
    used: dict[str, set[str]] = {}  # words blanked so far in earlier occurrences of the same text
    total = 0
    for stage in (0, 1):
        for _sweep in range(4):  # a sweep can fall short (repeats ran out of words); the next one tops it up
            remaining = want - total
            if remaining <= 0:
                break
            capacity = {
                line.id: max(0, min(
                    len([t for t in eligible[line.id][stage] if t.text.lower() not in used.get(keys[line.id], set())
                         and t not in chosen.get(line.id, [])]),
                    len(tokens[line.id]) - 1 - len(chosen.get(line.id, [])),  # one word always stays visible
                ))
                for line in lines
            }
            available = sum(capacity.values())
            if available == 0:
                break
            target = min(remaining, available)
            acc, given = 0.0, 0
            for line in lines:
                acc += target * capacity[line.id] / available
                quota = min(capacity[line.id], int(acc + 1e-9) - given)
                if quota <= 0:
                    continue
                pool = [t for t in eligible[line.id][stage] if t.text.lower() not in used.get(keys[line.id], set())
                        and t not in chosen.get(line.id, [])]
                picks = rng.sample(pool, min(quota, len(pool)))
                chosen.setdefault(line.id, []).extend(picks)
                used.setdefault(keys[line.id], set()).update(t.text.lower() for t in picks)
                given += len(picks)
                total += len(picks)
    return chosen


def build_drafts(lyrics: Lyrics, language: str, difficulty: str, mode: str = "choice") -> list[QuestionDraft]:
    """Blank a share of the lyrics' words (see DIFFICULTY_PERCENT), spread evenly over the whole song.

    Content words are chosen first; function words ("und", "zu") only once the content words run out
    (the 60% and 80% levels). A word repeated within its line is never blanked and every line keeps at
    least one visible word.
    """
    ensure_supported(language)
    rng = seeded_rng(lyrics.id, question_difficulty(mode, difficulty))
    lines = select_lines(list(lyrics.lines))
    vocab = {t.text.lower() for line in lyrics.lines for t in tokenize(line.text)}
    tokens = {line.id: tokenize(line.text) for line in lines}
    want = question_target(unique_word_count(lines), difficulty, mode)
    per_line = pick_blanks(lines, tokens, language, want, rng)

    drafts: list[QuestionDraft] = []
    for line in lines:
        picked = sorted(per_line.get(line.id, []), key=lambda t: t.start)
        if not picked:
            continue
        in_line = {t.text.lower() for t in tokens[line.id]}
        kept: list[tuple[Token, list[str]]] = []
        for tok in picked:
            if mode == "typing":  # the player types the word: nothing to choose from
                kept.append((tok, []))
                continue
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
            options = [] if mode == "typing" else [(tok.text, True)] + [(x, False) for x in d]
            rng.shuffle(options)
            drafts.append(QuestionDraft(line, i, tok.text, sentence, options))
    return drafts


def ensure_questions(
    session: Session, song: Song, lyrics: Lyrics, difficulty: str, version: int = GENERATOR_VERSION, mode: str = "choice",
) -> list[Question]:
    """Questions for (lyrics, difficulty, version): reuse the stored set, otherwise generate and persist it once.

    Only the current generator version can be generated; older sets stay stored for the games that began with them."""
    if difficulty not in DIFFICULTIES:
        raise AppError("invalid_difficulty", f"difficulty must be one of {', '.join(DIFFICULTIES)}", 422)
    if mode not in MODES:
        raise AppError("invalid_mode", f"mode must be one of {', '.join(MODES)}", 422)
    key = question_difficulty(mode, difficulty)

    def stored() -> list[Question]:
        return (
            session.query(Question).filter_by(lyrics_id=lyrics.id, difficulty=key, version=version)
            .order_by(Question.lyric_line_id, Question.blank_index).all()
        )

    existing = stored()
    if existing:
        return existing
    drafts = build_drafts(lyrics, song.language, difficulty, mode)
    if not drafts:
        raise AppError("no_questions", "Could not generate questions from these lyrics (too short or too few distinct words)", 422)
    for d in drafts:
        q = Question(
            song_id=song.id, lyrics_id=lyrics.id, lyric_line_id=d.line.id, difficulty=key, version=version,
            blank_index=d.blank_index, missing_word=d.word, sentence=d.sentence, audio_start=d.line.start_time, audio_end=d.line.end_time,
        )
        q.options = [QuestionOption(text=t, is_correct=ok, position=i) for i, (t, ok) in enumerate(d.options)]
        session.add(q)
    try:
        session.commit()
    except IntegrityError:  # a concurrent request generated the same set first
        session.rollback()
    return stored()
