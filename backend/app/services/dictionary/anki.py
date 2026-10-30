"""Anki exchange for the dictionary: export a deck (.apkg, Anki's legacy format, or plain text) and read one back.

An .apkg is a zip with `collection.anki2` (an SQLite file, schema 11) and `media` (a JSON map, empty here). One note per word:
front = the headword with its article, back = the translation and the song lines it came from, tags = the language and "chorus". The notes
carry a stable guid, so Anki updates them instead of duplicating them when the deck is imported again. The review schedule can travel too.
Everything is the standard library: a zip, an SQLite file in memory-backed temp, JSON.
"""
import hashlib
import html
import io
import json
import os
import re
import sqlite3
import tempfile
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from app.core.errors import AppError

DAY = 86400
MODEL_ID = 1_700_000_000_001  # one note type for Chorus decks
DECK_ID = 1_700_000_000_002
SEP = "\x1f"
MAX_NOTES = 20_000
MAX_BYTES = 60 * 1024 * 1024


@dataclass
class ExportWord:
    language: str
    word: str
    surface: str
    article: str | None
    translation: str | None
    examples: list[tuple[str, str | None, str]]  # (sentence, its translation, the song's title)
    # the schedule (only used when it is asked for)
    due_at: datetime | None = None
    interval_seconds: int = 0
    reps: int = 0
    lapses: int = 0
    suspended: bool = False
    user_id: int = 0


@dataclass
class ImportedNote:
    front: str
    back: str
    tags: list[str] = field(default_factory=list)
    # the schedule, when the deck has one
    interval_seconds: int = 0
    due_at: datetime | None = None
    reps: int = 0
    lapses: int = 0
    suspended: bool = False


def _plain(text: str) -> str:
    """HTML of a note field as plain text: line breaks kept, tags and sound/image markers gone."""
    text = re.sub(r"(?i)<br\s*/?>|</(?:div|p|li)>", "\n", text)
    text = re.sub(r"\[sound:[^\]]*\]", "", text)
    text = re.sub(r"<[^>]*>", "", text)
    text = html.unescape(text).replace("\xa0", " ")
    return "\n".join(line.strip() for line in text.split("\n")).strip()


def _guid(w: ExportWord) -> str:
    digest = hashlib.sha1(f"chorus:{w.user_id}:{w.language}:{w.word}".encode()).digest()
    n = int.from_bytes(digest[:8], "big")
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~"
    out = ""
    while n:
        n, r = divmod(n, len(alphabet))
        out = alphabet[r] + out
    return out or "0"


def front_of(w: ExportWord) -> str:
    return f"{w.article} {w.surface}" if w.article and not w.surface.lower().startswith(f"{w.article.lower()} ") else w.surface


def back_html(w: ExportWord) -> str:
    parts = []
    if w.translation:
        parts.append(f"<div>{html.escape(w.translation)}</div>")
    for sentence, translation, song in w.examples:
        tr = f" <span class=\"tr\">{html.escape(translation)}</span>" if translation else ""
        parts.append(f"<div class=\"ex\">{html.escape(sentence)}{tr} <i>— {html.escape(song)}</i></div>")
    return "".join(parts)


def _csum(front: str) -> int:
    return int(hashlib.sha1(_plain(front).encode()).hexdigest()[:8], 16)


def _model(now_s: int) -> dict:
    return {str(MODEL_ID): {
        "id": MODEL_ID, "name": "Chorus word", "type": 0, "mod": now_s, "usn": -1, "sortf": 0, "did": DECK_ID, "tags": [], "vers": [],
        "flds": [
            {"name": "Front", "ord": 0, "sticky": False, "rtl": False, "font": "Arial", "size": 20, "media": []},
            {"name": "Back", "ord": 1, "sticky": False, "rtl": False, "font": "Arial", "size": 20, "media": []},
        ],
        "tmpls": [{"name": "Word", "ord": 0, "qfmt": "{{Front}}", "afmt": "{{FrontSide}}<hr id=answer>{{Back}}", "bqfmt": "", "bafmt": "", "did": None, "bfont": "", "bsize": 0}],
        "css": ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; } .ex { font-size: 16px; margin-top: 8px; } .tr { color: #666; }",
        "latexPre": "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
        "latexPost": "\\end{document}", "req": [[0, "any", [0]]],
    }}


def _decks(now_s: int, name: str) -> dict:
    base = {"collapsed": False, "conf": 1, "desc": "", "dyn": 0, "extendNew": 10, "extendRev": 50, "lrnToday": [0, 0], "newToday": [0, 0], "revToday": [0, 0], "timeToday": [0, 0], "usn": -1, "mod": now_s}
    return {"1": {**base, "id": 1, "name": "Default"}, str(DECK_ID): {**base, "id": DECK_ID, "name": name}}


_CONF = {
    "activeDecks": [1], "addToCur": True, "collapseTime": 1200, "curDeck": 1, "curModel": str(MODEL_ID), "dueCounts": True, "estTimes": True,
    "newBury": True, "newSpread": 0, "nextPos": 1, "sortBackwards": False, "sortType": "noteFld", "timeLim": 0,
}
_DCONF = {"1": {"id": 1, "name": "Default", "replayq": True, "lapse": {"delays": [10], "leechAction": 0, "leechFails": 8, "minInt": 1, "mult": 0},
                "rev": {"perDay": 200, "ease4": 1.3, "fuzz": 0.05, "minSpace": 1, "ivlFct": 1, "maxIvl": 36500, "bury": True},
                "timer": 0, "maxTaken": 60, "usn": 0, "new": {"perDay": 20, "delays": [1, 10], "separate": True, "ints": [1, 4, 7], "initialFactor": 2500, "bury": True, "order": 1},
                "mod": 0, "autoplay": True}}


def build_apkg(words: list[ExportWord], deck_name: str, with_schedule: bool, now: datetime) -> bytes:
    """The .apkg (zip) for these words."""
    now_s = int(now.timestamp())
    crt = now_s - (now_s % DAY)  # the collection's day 0 (midnight UTC)
    fd, path = tempfile.mkstemp(suffix=".anki2")
    os.close(fd)
    try:
        db = sqlite3.connect(path)
        db.executescript("""
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn); CREATE INDEX ix_cards_usn on cards (usn); CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid); CREATE INDEX ix_cards_sched on cards (did, queue, due); CREATE INDEX ix_revlog_cid on revlog (cid); CREATE INDEX ix_notes_csum on notes (csum);
""")
        db.execute("INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')", (
            crt, now_s * 1000, now_s * 1000, json.dumps(_CONF), json.dumps(_model(now_s)), json.dumps(_decks(now_s, deck_name)), json.dumps(_DCONF),
        ))
        for position, w in enumerate(words[:MAX_NOTES]):
            nid = now_s * 1000 + position  # unique, ordered
            front, back = front_of(w), back_html(w)
            tags = f" {w.language} chorus "
            db.execute("INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')", (nid, _guid(w), MODEL_ID, now_s, tags, f"{front}{SEP}{back}", front, _csum(front)))
            ctype, queue, due, ivl, left = 0, 0, position + 1, 0, 0  # a new card
            if with_schedule and w.reps > 0 and w.due_at is not None:
                if w.interval_seconds >= DAY:
                    ctype, queue, ivl = 2, 2, w.interval_seconds // DAY
                    due = max(0, int((w.due_at.replace(tzinfo=timezone.utc) if w.due_at.tzinfo is None else w.due_at).timestamp() - crt) // DAY)
                else:
                    ctype, queue, left = 1, 1, 1001  # still learning: due is a time
                    due = int((w.due_at.replace(tzinfo=timezone.utc) if w.due_at.tzinfo is None else w.due_at).timestamp())
            if w.suspended:
                queue = -1
            db.execute("INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, ?, ?, ?, ?, 2500, ?, ?, ?, 0, 0, 0, '')", (
                nid, nid, DECK_ID, now_s, ctype, queue, due, ivl, w.reps if with_schedule else 0, w.lapses if with_schedule else 0, left,
            ))
        db.commit()
        db.close()
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(path, "collection.anki2")
            z.writestr("media", "{}")
        return buf.getvalue()
    finally:
        os.unlink(path)


def build_text(words: list[ExportWord]) -> str:
    """'Notes in Plain Text' (tab separated, HTML kept) that Anki's Import dialog reads directly."""
    lines = ["#separator:tab", "#html:true", "#tags column:3"]
    for w in words:
        cells = [front_of(w), back_html(w), f"{w.language} chorus"]
        lines.append("\t".join(c.replace("\t", " ").replace("\n", " ") for c in cells))
    return "\n".join(lines) + "\n"


# ---------- reading ----------

NEWER_FORMAT = (
    "This deck was exported in Anki's newer format, which Chorus cannot read. In Anki choose Export, tick \"Support older Anki versions\" "
    "(or choose Notes in Plain Text) and try again."
)


def parse_apkg(data: bytes) -> list[ImportedNote]:
    if len(data) > MAX_BYTES:
        raise AppError("deck_too_big", "That deck is too big to import (60 MB at most).", 413)
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise AppError("not_a_deck", "That file is not an Anki deck (.apkg).", 422) from e
    with z:
        names = set(z.namelist())
        if "collection.anki21b" in names and "collection.anki2" not in names:
            raise AppError("deck_newer_format", NEWER_FORMAT, 422)
        if "collection.anki2" not in names and "collection.anki21" not in names:
            raise AppError("not_a_deck", "That file is not an Anki deck (.apkg).", 422)
        name = "collection.anki21" if "collection.anki21" in names else "collection.anki2"
        info = z.getinfo(name)
        if info.file_size > 4 * MAX_BYTES:
            raise AppError("deck_too_big", "That deck is too big to import.", 413)
        raw = z.read(name)
    fd, path = tempfile.mkstemp(suffix=".anki2")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
        try:
            db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            return _read_collection(db)
        except sqlite3.DatabaseError as e:
            raise AppError("not_a_deck", "That file is not an Anki deck (.apkg).", 422) from e
        finally:
            try:
                db.close()
            except Exception:
                pass
    finally:
        os.unlink(path)


def _read_collection(db: sqlite3.Connection) -> list[ImportedNote]:
    crt, models_json = db.execute("SELECT crt, models FROM col").fetchone()
    models = json.loads(models_json or "{}")
    notes = db.execute("SELECT id, mid, tags, flds FROM notes ORDER BY id LIMIT ?", (MAX_NOTES + 1,)).fetchall()
    if len(notes) > MAX_NOTES:
        raise AppError("deck_too_big", f"That deck has more than {MAX_NOTES} notes: split it first.", 413)
    if len(notes) == 1 and "update to the latest" in notes[0][3].lower():
        raise AppError("deck_newer_format", NEWER_FORMAT, 422)  # Anki's placeholder in a deck made without "support older versions"
    cards: dict[int, tuple] = {}
    for nid, ctype, queue, due, ivl, reps, lapses in db.execute("SELECT nid, type, queue, due, ivl, reps, lapses FROM cards ORDER BY ord, id"):
        cards.setdefault(nid, (ctype, queue, due, ivl, reps, lapses))
    out: list[ImportedNote] = []
    for nid, mid, tags, flds in notes:
        fields = flds.split(SEP)
        names = [f.get("name", "") for f in (models.get(str(mid), {}).get("flds") or [])]
        front_i = 0
        back_i = names.index("Back") if "Back" in names else 1
        front = _plain(fields[front_i]) if fields else ""
        back = _plain(fields[back_i]) if len(fields) > back_i else ""
        if not front:
            continue
        note = ImportedNote(front=front.split("\n")[0].strip(), back=back, tags=[t for t in tags.split() if t])
        card = cards.get(nid)
        if card is not None:
            ctype, queue, due, ivl, reps, lapses = card
            note.reps, note.lapses, note.suspended = reps, lapses, queue == -1
            if ctype == 2 and ivl > 0:
                note.interval_seconds = ivl * DAY
                note.due_at = datetime.fromtimestamp(crt, timezone.utc) + timedelta(days=due)
            elif ctype == 1 and due > 10**9:
                note.interval_seconds = 600
                note.due_at = datetime.fromtimestamp(due, timezone.utc)
        out.append(note)
    return out


def parse_text(text: str) -> list[ImportedNote]:
    """Anki's 'Notes in Plain Text' (or any tab/semicolon/comma separated list: front, back, tags)."""
    lines = [l for l in text.replace("\ufeff", "").splitlines()]
    sep = None
    tag_col = None
    body = []
    for l in lines:
        if l.startswith("#"):
            m = re.match(r"#separator:(\w+|.)", l)
            if m:
                sep = {"tab": "\t", "comma": ",", "semicolon": ";", "space": " ", "pipe": "|", "colon": ":"}.get(m.group(1), m.group(1))
            m = re.match(r"#tags column:(\d+)", l)
            if m:
                tag_col = int(m.group(1)) - 1
            continue
        if l.strip():
            body.append(l)
    if not body:
        return []
    if sep is None:
        sep = next((s for s in ("\t", ";", ",") if s in body[0]), "\t")
    out: list[ImportedNote] = []
    for l in body[:MAX_NOTES]:
        cells = [c.strip().strip('"') for c in l.split(sep)]
        front = _plain(cells[0]) if cells else ""
        if not front:
            continue
        back = _plain(cells[1]) if len(cells) > 1 else ""
        tags = cells[tag_col].split() if tag_col is not None and len(cells) > tag_col else []
        out.append(ImportedNote(front=front, back=back, tags=tags))
    return out


# ---------- the dictionary side ----------

_ARTICLES = {
    "de": {"der", "die", "das"}, "fr": {"le", "la", "les", "l'"}, "es": {"el", "la", "los", "las"}, "it": {"il", "lo", "la", "i", "gli", "le", "l'"},
    "pt": {"o", "a", "os", "as"}, "nl": {"de", "het"},
}


def split_article(front: str, language: str) -> tuple[str | None, str]:
    """('der', 'Hund') for 'der Hund' in German; (None, text) when the language has no such article or nothing follows it."""
    articles = _ARTICLES.get(language.split("-")[0].lower())
    text = front.strip()
    if not articles or not text:
        return None, text
    first, _, rest = text.partition(" ")
    if first.lower() in articles and rest.strip():
        return first.lower(), rest.strip()
    m = re.match(r"(?i)^(l')(.+)$", text)
    if m and "l'" in articles:
        return "l'", m.group(2).strip()
    return None, text
