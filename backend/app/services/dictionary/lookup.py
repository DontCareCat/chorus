"""Outside lookups for the dictionary: a translation service (MyMemory's API) and Wiktionary (noun genders).

Both are reached through small clients that can be replaced in tests (`deps.get_translator`, `deps.get_wiktionary`),
both identify themselves, retry on server errors and keep a cache table so each text is sent out only once.
"""
import hashlib
import html
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
            out = html.unescape(str(data["responseData"]["translatedText"])).strip()  # MyMemory answers with HTML entities (&#39;, &quot;)
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
_GENDER_ARG = re.compile(r"^(?:g\d?=)?(m|f|n|c)(?:[-.][a-z]+)*$")  # "n.sg": a noun with no plural
# any "... of" template pointing at the base form: {{verb form of|de|kommen||3|s}}, {{inflection of|de|ich||dat}}, {{plural of|de|Haus}}
# only templates that say "this word is an inflected form of that one"; "clipping of", "synonym of", "contraction of", "ellipsis of" ... are senses of their own
_INFLECTION = r"(?:infl|inflection|verb form|noun form|adj form|adjective form|plural|participle|past participle|present participle|gerund|comparative|superlative|(?:[a-z]+ )?(?:singular|plural|genitive|dative|accusative|nominative|imperative))"
_LEMMA = re.compile(r"\{\{\s*" + _INFLECTION + r"\s+of\s*\|\s*(?:[a-z]{2,3}\s*\|)\s*\|?\s*(?!\w+=)([^|}]+)")
_LEMMA_ADJ = re.compile(r"\{\{\s*de-[a-z]+ form of\s*\|\s*([^|}]+)")  # {{de-adj form of|hell|...}}
_HEADING = re.compile(r"(?m)^(={3,5})\s*([^=\n]+?)\s*\1\s*$")
POS_FAMILY = {
    "noun": "noun", "proper noun": "noun", "verb": "verb", "adjective": "adj", "adverb": "adv", "pronoun": "pron",
    "numeral": "num", "article": "det", "determiner": "det", "preposition": "prep", "postposition": "prep", "conjunction": "conj",
    "particle": "part", "interjection": "intj", "contraction": "other", "prefix": "other", "suffix": "other", "phrase": "other",
}


@dataclass(frozen=True)
class WordInfo:
    found: bool = False  # the language section exists on Wiktionary
    lemma: str | None = None  # set when the word is an inflected form of another
    gender: str | None = None  # m | f | n | c (of the lemma, for a noun)
    is_noun: bool = False
    pos: str | None = None  # noun | verb | adj | adv | ... of the chosen reading
    gloss: str | None = None  # the English meaning(s) of the lemma, from its first definitions


@dataclass(frozen=True)
class Reading:
    pos: str
    gender: str | None
    lemma: str | None
    gloss: str | None


def clean_gloss(line: str) -> str:
    """'# {{lb|de|military}} to [[fall]], to [[drop]]' -> 'to fall, to drop' (no templates, links or markup)."""
    t = line
    for _ in range(3):  # templates nest ({{lb|de|with {{l|de|es}}}}): clean the innermost first
        t = re.sub(r"\{\{(?:l|m|link|mention|w)\|[^|{}]*\|([^|{}]*)[^{}]*\}\}", r"\1", t)
        t = re.sub(r"\{\{(?:lb|lbl|label|q|qual|qualifier|gl|gloss|sense|i|a|n-g|ng|nb|non-gloss)\|[^{}]*\}\}", "", t)
    t = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", t)
    for _ in range(3):
        t = re.sub(r"\{\{[^{}]*\}\}", "", t)
    t = re.sub(r"<[^>]+>|'{2,}|\{\{|\}\}", "", t)
    t = re.sub(r"\(\s*see\b[^)]*\)", "", t, flags=re.I)  # "(see usage notes)": a pointer into the page, not a meaning
    t = re.sub(r"\(\s*\)", "", t)  # a template was all there was between the brackets
    t = re.sub(r"\s+", " ", t).strip(" ;,:.")
    if t.count("(") != t.count(")"):
        t = t.replace("(", "").replace(")", "").strip(" ;,:.")
    return t if re.search(r"[^\W\d_]", t) else ""  # no letter at all: no meaning (one letter can be right: ich = "I")


def _gender_of(block: str, code: str) -> str | None:
    for tpl in re.finditer(r"\{\{\s*(?:%s-noun|head\|%s\|[a-z ]*noun[a-z ]*)\b([^{}]*)\}\}" % (re.escape(code), re.escape(code)), block):
        for arg in tpl.group(1).split("|"):
            arg = arg.strip()
            first = arg.split(",")[0].strip()  # "{{de-noun|n,s|Häuser}}": gender, then the genitive ending
            g = _GENDER_ARG.match(first if "=" not in arg else arg)
            if g and not first.endswith("-p"):
                return g.group(1)
    return None


def readings(text: str, language_name: str, code: str) -> list[Reading] | None:
    """Every part-of-speech block of one language's section (None when the language has no section on the page)."""
    m = re.search(rf"(?m)^==\s*{re.escape(language_name)}\s*==\s*$", text)
    if m is None:
        return None
    rest = text[m.end():]
    nxt = re.search(r"(?m)^==[^=]", rest)
    section = rest[: nxt.start()] if nxt else rest
    heads = list(_HEADING.finditer(section))
    out: list[Reading] = []
    for i, h in enumerate(heads):
        pos = POS_FAMILY.get(h.group(2).strip().lower())
        if pos is None:
            continue
        block = section[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(section)]
        defs = [ln for ln in block.splitlines() if re.match(r"#{1,2}(?![#*:])", ln)]
        lemma, gloss = None, None
        for ln in defs:
            lm = (_LEMMA.search(ln) or _LEMMA_ADJ.search(ln)) if ln is defs[0] else None  # a later sense does not make the whole word a form of another
            if lm:
                lemma = re.sub(r"\[\[|\]\]", "", lm.group(1)).strip() or None
                tail = ln[ln.find("}}", lm.end()) + 2:] if "}}" in ln[lm.end():] else ""
                subs = [g for g in (clean_gloss(re.sub(r"^#+\s*", "", x)) for x in defs[1:] if x.startswith("##")) if g]
                if subs:  # {{gerund of|de|warten}} with the meanings under it
                    gloss = "; ".join(subs[:2])[:120]
                elif pos != "verb":  # "mir": {{inflection of|de|ich||dat}}: me, to me  -> the form's own meaning
                    given = re.search(r"\|\s*(?:t|gloss)=([^|}]+)", ln[lm.end(): lm.end() + ln[lm.end():].find("}}")])
                    gloss = clean_gloss(given.group(1)) if given else clean_gloss(tail) or None
                break
        if lemma is None:
            glosses = list(dict.fromkeys(g for g in (clean_gloss(re.sub(r"^#+\s*", "", ln)) for ln in defs) if g))
            gloss = "; ".join(glosses[:2])[:120] or None
        out.append(Reading(pos=pos, gender=_gender_of(block, code) if pos == "noun" else None, lemma=lemma, gloss=gloss))
    return out


def choose(found: list[Reading], noun_hint: bool | None) -> Reading | None:
    """Which reading of a page the sung word is. A lowercase word is not a noun (German nouns are capitalised); a capitalised word
    inside a line is a noun; a capitalised first word of a line could be either, so the other readings come first."""
    if not found:
        return None
    nouns = [r for r in found if r.pos == "noun"]
    others = [r for r in found if r.pos != "noun"]
    return (nouns + others if noun_hint else others + nouns)[0]


def info_of(r: Reading | None) -> WordInfo:
    if r is None:
        return WordInfo(found=True)
    return WordInfo(found=True, lemma=r.lemma, gender=r.gender, is_noun=r.pos == "noun", pos=r.pos, gloss=r.gloss)


def parse_wikitext(text: str, language_name: str, code: str, noun_hint: bool | None = None) -> WordInfo:
    """Read one Wiktionary page for the reading of the word: part of speech, gender, the lemma it inflects, the English definitions."""
    found = readings(text, language_name, code)
    return WordInfo() if found is None else info_of(choose(found, noun_hint))


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
            if data["error"].get("code") == "missingtitle":
                return None  # no such page
            raise LookupUnavailable(f"Wiktionary: {data['error'].get('code', 'error')}")  # ratelimited, maxlag, readonly ...: not "the word does not exist"
        return data.get("parse", {}).get("wikitext")

    def _readings(self, titles: list[str], name: str, code: str) -> list[Reading]:
        for title in dict.fromkeys(titles):
            text = self.page(title)
            found = readings(text, name, code) if text is not None else None
            if found:
                return found
        return []

    def info(self, word: str, code: str, noun_hint: bool | None = None, _depth: int = 0) -> WordInfo:
        """What the sung word is. `noun_hint`: True = capitalised inside a line (a noun), False = lowercase, None = capitalised
        only as the first word of a line (either). Follows an inflected form to its lemma and takes the gender and the English
        definitions from the lemma's page, in the same part of speech."""
        name = LANGUAGE_NAMES.get(code)
        if name is None:
            return WordInfo()
        low, cap = word.lower(), word[:1].upper() + word[1:].lower()
        titles = [cap, low] if noun_hint else [low, cap]  # lyrics written in lowercase fall back to the capitalised (noun) page
        found = self._readings([word] + titles if word not in (low, cap) else titles, name, code)
        if not found:
            elided = re.sub(r"(?<=\w)'n\b", "en", word)
            elided = re.sub(r"(?<=\w)'s\b", "es", elided)
            if elided != word and _depth == 0:  # "geh'n" is a poetic spelling of "gehen"
                base = self.info(elided, code, noun_hint, 1)
                return WordInfo(found=base.found, lemma=base.lemma or elided, gender=base.gender, is_noun=base.is_noun, pos=base.pos, gloss=base.gloss) if base.found else WordInfo()
            return WordInfo()
        r = choose(found, noun_hint)
        if r is None or r.lemma is None or _depth >= 2:
            return info_of(r)
        target = self._readings([r.lemma[:1].upper() + r.lemma[1:], r.lemma] if r.pos == "noun" else [r.lemma, r.lemma[:1].upper() + r.lemma[1:]], name, code)
        lr = next((x for x in target if x.pos == r.pos), target[0] if target else None)
        if lr is not None and lr.lemma is not None and _depth < 1:  # a form of a form (an alternative spelling of an inflection)
            deeper = self.info(r.lemma, code, r.pos == "noun", _depth + 1)
            return WordInfo(found=True, lemma=deeper.lemma or r.lemma, gender=deeper.gender, is_noun=r.pos == "noun", pos=r.pos, gloss=r.gloss or deeper.gloss)
        return WordInfo(found=True, lemma=r.lemma, gender=lr.gender if lr else None, is_noun=r.pos == "noun", pos=r.pos, gloss=r.gloss or (lr.gloss if lr else None))


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


def bad_meaning(text: str | None) -> bool:
    """Empty, nothing that reads as a word, a bracket left behind by a removed template, or a pointer into the Wiktionary page."""
    if not text or not text.strip():
        return True
    return (not re.search(r"[^\W\d_]", text) or text.count("(") != text.count(")") or bool(re.search(r"\(\s*\)", text))
            or bool(re.search(r"\(\s*see\b", text, re.I)))


def cached_word_info(session: Session, wiktionary: Wiktionary, word: str, code: str, noun_hint: bool | None = None, fresh: bool = False) -> WordInfo:
    """`fresh`: "look up again" asks Wiktionary again and replaces the cached answer."""
    key = _key("wk3", code, word, str(noun_hint))
    row = session.query(DictionaryCache).filter_by(cache_key=key).one_or_none()
    if row is not None and not fresh:
        return WordInfo(**json.loads(row.payload))
    info = wiktionary.info(word, code, noun_hint)
    if row is not None:
        session.delete(row)
        session.flush()
    session.add(DictionaryCache(cache_key=key, payload=json.dumps(info.__dict__)))
    session.commit()
    return info
