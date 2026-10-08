import random

from app.services.game.nlp import common_words, zipf

POOL_SIZE = 25  # best-scoring candidates to sample from


def shape(word: str, like: str) -> str:
    """Give `word` the capitalisation shape of `like` (German nouns, ALL CAPS, lowercase)."""
    if len(like) > 1 and like.isupper():
        return word.upper()
    if like[:1].isupper():
        return word[:1].upper() + word[1:]
    return word.lower()


def _score(cand: str, correct: str, lang: str, in_song: bool) -> float:
    c, t = cand.lower(), correct.lower()
    s = abs(len(c) - len(t)) * 1.0
    s += 0 if c[-2:] == t[-2:] else 1.0  # similar ending ≈ similar word class / inflection
    s += abs(zipf(c, lang) - zipf(t, lang)) * 0.8  # similar frequency, so rarity is not a giveaway
    return s - (1.0 if in_song else 0.0)


def pick_distractors(
    correct: str, lang: str, song_vocab: set[str], exclude: set[str], rng: random.Random, n: int = 3,
    function_word: bool = False,
) -> list[str] | None:
    """Return n distractors shaped like `correct`, or None if the pool is too small.

    Candidates come from the song's own vocabulary and the language's frequent words; they are ranked by
    length / ending / frequency similarity (a POS-free proxy for 'same grammatical category').
    """
    banned = {w.lower() for w in exclude} | {correct.lower()}
    pool: dict[str, bool] = {}
    min_len = 2 if function_word else 3
    for w in song_vocab:
        if w.lower() not in banned and len(w) >= min_len:
            pool[w.lower()] = True
    for w in common_words(lang, function_words=function_word):
        if w not in banned:
            pool.setdefault(w, False)
    if len(pool) < n:
        return None
    ranked = sorted(pool, key=lambda w: (_score(w, correct, lang, pool[w]), w))[:POOL_SIZE]
    if len(ranked) < n:
        return None
    return [shape(w, correct) for w in rng.sample(ranked, n)]
