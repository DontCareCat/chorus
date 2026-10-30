"""Dictionary repair: wrong lemmas and unusable meanings from the old Wiktionary parser, entries stuck on 'failed', and one card per base word and type.

Revision ID: 0014
Revises: 0013

Run only together with the parser fix (wk3 cache key): the old answers are dropped from the cache so a new lookup really asks again.
Idempotent: a second run finds no duplicates and flags only what is still unusable. Words, example lines and review progress stay.
A card is one base word and type: leiht and leihen are 'leihen', the verb 'macht' is 'machen' and the noun 'Macht' is 'macht#n'. Entries that look sound
get that key from what is stored; the others are looked up again (and take their key when the lookup is done).
"""
import re
import unicodedata

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

MAX_EXAMPLES = 5
LOOKUP_VERSION = 1  # enrich_entry writes this on every finished lookup; only older entries are looked up again


def norm_key(word: str) -> str:
    return unicodedata.normalize("NFC", word).strip().replace("’", "'").replace("ʼ", "'").casefold()[:100]


def sentence_key(text: str) -> str:
    return " ".join("".join(c if c.isalnum() else " " for c in text.casefold()).split())


def bad_meaning(t: str | None) -> bool:
    """Empty, nothing that reads as a word, a bracket left behind by a removed template, or a pointer into the Wiktionary page."""
    if not t or not t.strip():
        return True
    return (not re.search(r"[^\W\d_]", t) or t.count("(") != t.count(")") or bool(re.search(r"\(\s*\)", t))
            or bool(re.search(r"\(\s*see\b", t, re.I)))


def card_key_stored(r) -> str:
    base = norm_key(r["lemma"] or r["surface"])
    return f"{base}#n" if r["article"] else base


def suspicious(r) -> bool:
    """Entries to look up again: failed, a bad meaning, anything with a lemma (the old parser could give a wrong one), a capitalised word with no article."""
    surface = r["surface"].strip()
    short = sum(c.isalpha() for c in r["translation"] or "") < 2
    capitalised = r["lemma"] is None and r["article"] is None and surface != surface.lower()
    return r["enrich_status"] == "failed" or bad_meaning(r["translation"]) or short or r["lemma"] is not None or capitalised


def repair(conn) -> dict:
    rows = conn.execute(sa.text(
        "SELECT id, user_id, language, word, surface, lemma, article, translation, translation_language, enrich_status, suspended, added_at, "
        "due_at, interval_seconds, reps, lapses, introduced_at, last_reviewed_at, lookup_version FROM dictionary_entries ORDER BY id")).mappings().all()
    groups: dict[tuple, list] = {}
    for r in rows:
        r = dict(r)
        r["_redo"] = r["lookup_version"] < LOOKUP_VERSION and suspicious(r)
        key = norm_key(r["word"]) if r["_redo"] or r["lookup_version"] >= LOOKUP_VERSION else card_key_stored(r)
        groups.setdefault((r["user_id"], r["language"], key[:100]), []).append(r)
    stats = {"merged": 0, "rekeyed": 0, "requeued": 0, "meanings_cleared": 0}
    # the most advanced card keeps its whole schedule: due date and interval only make sense together
    rank = lambda e: (e["reps"] or 0, e["interval_seconds"] or 0, str(e["last_reviewed_at"] or ""), -e["id"])
    for (_u, _l, key), entries in groups.items():
        entries.sort(key=rank, reverse=True)
        keep, others = entries[0], entries[1:]
        everyone = [keep, *others]
        if others:
            have = {sentence_key(s) for (s,) in conn.execute(sa.text("SELECT sentence FROM dictionary_examples WHERE entry_id = :e"), {"e": keep["id"]})}
            for o in others:
                for ex_id, sentence in conn.execute(sa.text("SELECT id, sentence FROM dictionary_examples WHERE entry_id = :e ORDER BY id"), {"e": o["id"]}).all():
                    if sentence_key(sentence) in have or len(have) >= MAX_EXAMPLES:
                        conn.execute(sa.text("DELETE FROM dictionary_examples WHERE id = :i"), {"i": ex_id})
                    else:
                        have.add(sentence_key(sentence))
                        conn.execute(sa.text("UPDATE dictionary_examples SET entry_id = :k WHERE id = :i"), {"k": keep["id"], "i": ex_id})
                conn.execute(sa.text("DELETE FROM dictionary_entries WHERE id = :i"), {"i": o["id"]})
                stats["merged"] += 1
            good = next((e for e in everyone if not bad_meaning(e["translation"])), keep)
            dates = lambda f: [e[f] for e in everyone if e[f] is not None]
            keep.update(
                translation=good["translation"], translation_language=good["translation_language"], reps=max(e["reps"] or 0 for e in everyone),
                lapses=max(e["lapses"] or 0 for e in everyone), suspended=all(e["suspended"] for e in everyone), added_at=min(dates("added_at")),
                introduced_at=min(dates("introduced_at"), default=None), last_reviewed_at=max(dates("last_reviewed_at"), default=None),
            )
        redo = any(e["_redo"] for e in everyone)
        clear = keep["translation"] is not None and bad_meaning(keep["translation"])
        if clear:
            keep["translation"] = keep["translation_language"] = None
            stats["meanings_cleared"] += 1
        status = "pending" if redo else keep["enrich_status"]
        stats["requeued"] += redo
        stats["rekeyed"] += key != keep["word"]
        version = keep["lookup_version"] if redo else max(keep["lookup_version"], LOOKUP_VERSION)
        conn.execute(sa.text(
            "UPDATE dictionary_entries SET word = :word, translation = :translation, translation_language = :translation_language, enrich_status = :status, reps = :reps, "
            "lapses = :lapses, suspended = :suspended, added_at = :added_at, introduced_at = :introduced_at, last_reviewed_at = :last_reviewed_at, lookup_version = :version WHERE id = :id"),
            {**{k: keep[k] for k in ("translation", "translation_language", "reps", "lapses", "suspended", "added_at", "introduced_at", "last_reviewed_at", "id")}, "word": key, "status": status, "version": version})
    conn.execute(sa.text("DELETE FROM dictionary_cache WHERE cache_key LIKE 'wk2:%'"))
    return stats


def upgrade() -> None:
    op.add_column("dictionary_entries", sa.Column("lookup_version", sa.Integer(), nullable=False, server_default="0"))
    repair(op.get_bind())


def downgrade() -> None:
    op.drop_column("dictionary_entries", "lookup_version")  # the cleared values are fetched again; merged duplicates stay merged
