"""Outside lookups for the dictionary: a translation service (MyMemory's API) and Wiktionary (noun genders).

Both are reached through small clients that can be replaced in tests (`deps.get_translator`, `deps.get_wiktionary`),
both identify themselves, retry on server errors and keep a cache table so each text is sent out only once.
"""
import hashlib
import json
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

import httpx
from sqlalchemy.orm import Session

from app import __version__
from app.core.config import settings
from app.db.models import DictionaryCache

USER_AGENT = f"Chorus/{__version__} (private language-learning app; https://github.com/DontCareCat/chorus)"
MAX_TEXT = 500


class LookupUnavailable(Exception):
    """The service did not answer usefully (network, quota, server error). Nothing is cached; a later try may work."""


class _Http:
    def __init__(self, http: httpx.Client, retries: int, backoff: float, sleep: Callable[[float], None],
                 clock: Callable[[], float], min_gap: float):
        self.http, self.retries, self.backoff, self.sleep, self.clock, self.min_gap = http, retries, backoff, sleep, clock, min_gap
        self._last = float("-inf")
        self._lock = threading.Lock()

    def get(self, path: str, params: dict) -> httpx.Response:
        last: Exception | None = None
        for attempt in range(self.retries):
            with self._lock:  # one request at a time, spaced out: background tasks run in parallel
                wait = self.min_gap - (self.clock() - self._last)
                if wait > 0:
                    self.sleep(wait)
                self._last = self.clock()
                try:
                    r = self.http.get(path, params=params)
                    if r.status_code < 500 and r.status_code != 429:
                        return r
                    last = LookupUnavailable(f"HTTP {r.status_code}")
                except httpx.TransportError as e:
                    last = e
            if attempt + 1 < self.retries:
                self.sleep(self.backoff * 2**attempt)
        raise LookupUnavailable(str(last))


class Translator(_Http):
    def __init__(self, http: httpx.Client | None = None, retries: int = 3, backoff: float = 0.5,
                 sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic, min_gap: float = 0.4):
        http = http or httpx.Client(base_url=settings.translate_base_url, headers={"User-Agent": USER_AGENT}, timeout=15)
        super().__init__(http, retries, backoff, sleep, clock, min_gap)

    def translate(self, text: str, source: str, target: str) -> str:
        r = self.get("/get", {"q": text[:MAX_TEXT], "langpair": f"{source}|{target}"})
        if r.status_code != 200:
            raise LookupUnavailable(f"translation service returned HTTP {r.status_code}")
        try:
            data = r.json()
            out = str(data["responseData"]["translatedText"]).strip()
            status = int(data.get("responseStatus", 200))
        except (ValueError, KeyError, TypeError):
            raise LookupUnavailable("unreadable answer from the translation service")
        if status != 200 or re.search(r"MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE", out, re.I):
            raise LookupUnavailable(out[:120] or f"translation service status {status}")
        return out


# gender letters used by Wiktionary -> article, per language
ARTICLES = {
    "de": {"m": "der", "f": "die", "n": "das"},
    "fr": {"m": "le", "f": "la"},
    "es": {"m": "el", "f": "la"},
    "it": {"m": "il", "f": "la"},
    "pt": {"m": "o", "f": "a"},
    "nl": {"m": "de", "f": "de", "c": "de", "n": "het"},
}
VOWELS = "aeiouàâäèéêëìîïòôöùûüáíóúæœ"
_GENDER_ARG = re.compile(r"^(?:g\d?=)?(m|f|n|c)(?:-[a-z]+)?$")
_LEMMA = re.compile(r"\{\{\s*(?:plural of|inflection of|infl of|form of|alternative form of|alt form|alt form of|participle of|"
                    r"past participle of|present participle of|(?:[a-z]{2}-)?(?:noun|adj|verb|adjective) form of)\s*\|\s*(?:[a-z]{2,3}\s*\|)?\s*([^|}]+)")


@dataclass(frozen=True)
class WordInfo:
    found: bool = False  # the language section exists on Wiktionary
    lemma: str | None = None  # set when the word is an inflected form of another
    gender: str | None = None  # m | f | n | c
    is_noun: bool = False


def article_for(language: str, gender: str | None, word: str) -> str | None:
    """'der' for (de, n, Haus); the elided forms (l') of French and Italian are handled; None when there is none."""
    art = ARTICLES.get(language, {}).get(gender or "")
    if art is None:
        return None
    first = word[:1].lower()
    if language == "fr" and first in VOWELS:
        return "l'"
    if language == "it":
        if first in VOWELS:
            return "l'"
        if gender == "m" and (first == "z" or word[:2].lower() in ("gn", "ps", "pn", "sc", "sp", "st", "sb", "sd", "sf", "sg", "sl", "sm", "sn", "sr", "sv")):
            return "lo"
    return art


def parse_wikitext(text: str, language_name: str, code: str) -> WordInfo:
    """Read one Wiktionary page: the section of `language_name`, whether it has a noun, its gender, or the lemma it inflects."""
    m = re.search(rf"(?m)^==\s*{re.escape(language_name)}\s*==\s*$", text)
    if m is None:
        return WordInfo()
    rest = text[m.end():]
    nxt = re.search(r"(?m)^==[^=]", rest)
    section = rest[: nxt.start()] if nxt else rest
    gender = None
    for tpl in re.finditer(r"\{\{\s*(?:%s-noun|head\|%s\|[a-z ]*noun[a-z ]*)\b([^{}]*)\}\}" % (re.escape(code), re.escape(code)), section):
        for arg in tpl.group(1).split("|"):
            arg = arg.strip()
            first = arg.split(",")[0].strip()  # "{{de-noun|n,s|Häuser}}": gender, then the genitive ending
            g = _GENDER_ARG.match(first if "=" not in arg else arg)
            if g and not first.endswith("-p"):
                gender = g.group(1)
                break
        if gender:
            break
    is_noun = gender is not None or re.search(r"(?m)^===+\s*Noun\s*===+\s*$", section) is not None
    lemma = None
    if gender is None:
        lm = _LEMMA.search(section)
        if lm:
            lemma = lm.group(1).strip()
    return WordInfo(found=True, lemma=lemma, gender=gender, is_noun=is_noun)


LANGUAGE_NAMES = {"de": "German", "fr": "French", "es": "Spanish", "it": "Italian", "pt": "Portuguese", "nl": "Dutch"}


class Wiktionary(_Http):
    def __init__(self, http: httpx.Client | None = None, retries: int = 3, backoff: float = 0.5,
                 sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic, min_gap: float = 0.2):
        http = http or httpx.Client(base_url=settings.wiktionary_base_url, headers={"User-Agent": USER_AGENT}, timeout=15)
        super().__init__(http, retries, backoff, sleep, clock, min_gap)

    def page(self, title: str) -> str | None:
        r = self.get("/w/api.php", {"action": "parse", "page": title, "prop": "wikitext", "format": "json", "formatversion": 2, "redirects": 1})
        if r.status_code != 200:
            raise LookupUnavailable(f"Wiktionary returned HTTP {r.status_code}")
        try:
            data = r.json()
        except ValueError:
            raise LookupUnavailable("unreadable answer from Wiktionary")
        if "error" in data:
            return None  # no such page
        return data.get("parse", {}).get("wikitext")

    def info(self, word: str, code: str) -> WordInfo:
        name = LANGUAGE_NAMES.get(code)
        if name is None:
            return WordInfo()
        best = WordInfo()
        for title in dict.fromkeys([word, word.capitalize(), word.lower()]):  # nouns are capitalised in German; the lyrics may not
            text = self.page(title)
            if text is None:
                continue
            info = parse_wikitext(text, name, code)
            if info.found and (info.gender or info.lemma):
                return info
            if info.found and not best.found:
                best = info
        return best


# ---------- cache ----------
def _key(kind: str, *parts: str) -> str:
    return f"{kind}:{hashlib.sha1('|'.join(parts).encode()).hexdigest()}"


def cached_translation(session: Session, translator: Translator, text: str, source: str, target: str) -> str:
    key = _key("tr", source, target, text)
    row = session.query(DictionaryCache).filter_by(cache_key=key).one_or_none()
    if row is not None:
        return json.loads(row.payload)
    out = translator.translate(text, source, target)
    session.add(DictionaryCache(cache_key=key, payload=json.dumps(out)))
    session.commit()
    return out


def cached_word_info(session: Session, wiktionary: Wiktionary, word: str, code: str) -> WordInfo:
    key = _key("wk", code, word.casefold())
    row = session.query(DictionaryCache).filter_by(cache_key=key).one_or_none()
    if row is not None:
        return WordInfo(**json.loads(row.payload))
    info = wiktionary.info(word, code)
    session.add(DictionaryCache(cache_key=key, payload=json.dumps(info.__dict__)))
    session.commit()
    return info
