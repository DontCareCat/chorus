"""Guess the language of a song from its lyrics.

No extra dependency: `wordfreq` (already used for the questions) knows how common every word is in each language, so the
language whose word list explains the lyrics best wins. A guess is only made when it is clear: enough words, a good fit,
and a clear lead over the runner-up (so "la la la" or a language we have no word list for gives no answer).
"""
import re
from dataclasses import dataclass

from wordfreq import available_languages, zipf_frequency

# Languages with a word list and without extra tokenizers (Japanese, Chinese, Korean need MeCab/jieba: not supported).
CANDIDATES = (
    "ar bg ca cs da de el en es et fa fi fr he hi hr hu id it lt lv nb nl pl pt ro ru sk sr sv tr uk"
).split()
MIN_WORDS = 8  # fewer words than this tell us nothing
MIN_FIT = 3.5  # average Zipf frequency of the lyrics' words in the winning language (a language that really fits is ~5-6)
MIN_LEAD = 0.5  # ... and it must beat the runner-up by this much
MAX_WORDS = 600
TOKEN = re.compile(r"[^\W\d_]+(?:['’-][^\W\d_]+)*", re.UNICODE)


@dataclass(frozen=True)
class Detection:
    language: str
    fit: float  # average Zipf frequency in that language
    lead: float  # how far ahead of the second best


def _languages() -> list[str]:
    known = set(available_languages())
    return [c for c in CANDIDATES if c in known]


def detect_language(text: str) -> Detection | None:
    words = [w.lower() for w in TOKEN.findall(text) if len(w) >= 2]
    if len(words) < MIN_WORDS:
        return None
    if len(words) > MAX_WORDS:  # an even sample over the song is as good as all of it
        step = len(words) / MAX_WORDS
        words = [words[int(i * step)] for i in range(MAX_WORDS)]
    scores = sorted(
        ((sum(zipf_frequency(w, lang) for w in words) / len(words), lang) for lang in _languages()), reverse=True,
    )
    (best, language), (second, _) = scores[0], scores[1]
    if best < MIN_FIT or best - second < MIN_LEAD:
        return None
    return Detection(language, round(best, 2), round(best - second, 2))
