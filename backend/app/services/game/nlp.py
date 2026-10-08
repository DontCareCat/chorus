import re
from dataclasses import dataclass
from functools import lru_cache

from wordfreq import available_languages, top_n_list, zipf_frequency

from app.core.errors import AppError

# Languages written without spaces need a real segmenter (not in the MVP).
UNSUPPORTED = {"ja", "zh", "th", "lo", "km", "my"}
TOKEN = re.compile(r"[^\W\d_]+(?:['’-][^\W\d_]+)*", re.UNICODE)
MIN_WORD_LEN = 3
STOPWORD_ZIPF = 6.0  # words this frequent are function words / fillers, never blanked


@dataclass(frozen=True)
class Token:
    text: str
    start: int
    end: int


def base_language(lang: str) -> str:
    return lang.lower().replace("_", "-").split("-")[0]


def ensure_supported(lang: str) -> None:
    if base_language(lang) in UNSUPPORTED:
        raise AppError("language_not_supported", f"Questions for '{lang}' are not supported yet (needs a word segmenter)", 422)


def tokenize(text: str) -> list[Token]:
    return [Token(m.group(), m.start(), m.end()) for m in TOKEN.finditer(text)]


def zipf(word: str, lang: str) -> float:
    return zipf_frequency(word.lower(), base_language(lang))


def has_frequency_data(lang: str) -> bool:
    return base_language(lang) in available_languages()


def normalize_line(text: str) -> str:
    return " ".join(t.text.lower() for t in tokenize(text))


@lru_cache(maxsize=64)
def common_words(lang: str, n: int = 8000, function_words: bool = False) -> tuple[str, ...]:
    """Frequent, purely alphabetic words (lowercase) usable as distractors.

    function_words=False: content words only (very frequent words excluded).
    function_words=True: the most frequent words, including short function words ("und", "zu", "mit"),
    used when the blanked word itself is one.
    """
    base = base_language(lang)
    if base not in available_languages():
        return ()
    if function_words:
        return tuple(w for w in top_n_list(base, 3000) if w.isalpha() and len(w) >= 2)
    return tuple(
        w for w in top_n_list(base, n)
        if w.isalpha() and len(w) >= MIN_WORD_LEN and zipf_frequency(w, base) < STOPWORD_ZIPF
    )
