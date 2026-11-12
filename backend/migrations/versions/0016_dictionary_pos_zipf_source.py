"""dictionary entries keep part of speech, word frequency and where they came from; users choose how words are added

Revision ID: 0016
Revises: 0015

entries.pos / zipf / source / meaning_edited, examples.song_id may be empty (a sentence typed by hand), users.dictionary_mode ('auto' | 'manual', default auto: nothing changes for existing users).
The backfill only fills what is still empty, so running it again changes nothing. pos comes from the cached Wiktionary answers (a '#n' key is a noun),
zipf from wordfreq (empty for languages it has no data for), source is 'import' for words without an example line or with a recording, else 'game'.
"""
import hashlib
import json

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def _cache_key(kind: str, *parts: str) -> str:
    return f"{kind}:{hashlib.sha1('|'.join(parts).encode()).hexdigest()}"


def _zipf(word: str, language: str) -> float | None:
    try:
        from wordfreq import available_languages, zipf_frequency
    except ImportError:  # the packaged app always has it; a bare test database may not
        return None
    base = language.lower().replace("_", "-").split("-")[0]
    if base not in available_languages():
        return None
    value = zipf_frequency(word.lower(), base)
    return round(value, 2) if value > 0 else None


def backfill(conn) -> dict:
    cache = {k: p for k, p in conn.execute(sa.text("SELECT cache_key, payload FROM dictionary_cache WHERE cache_key LIKE 'wk4:%'")).all()}
    rows = conn.execute(sa.text("SELECT id, language, word, surface, lemma, pos, zipf FROM dictionary_entries WHERE pos IS NULL OR zipf IS NULL")).all()
    pos_set = zipf_set = 0
    for r in rows:
        pos, zipf = r.pos, r.zipf
        if pos is None:
            if r.word.endswith("#n"):
                pos = "noun"
            else:
                for hint in (None, True, False):  # the hint the lookup was made with is not stored: try the three
                    payload = cache.get(_cache_key("wk4", r.language, r.surface, str(hint)))
                    found = json.loads(payload).get("pos") if payload else None
                    if found:
                        pos = found
                        break
        if zipf is None:
            zipf = _zipf(r.lemma or r.surface, r.language)
        if pos != r.pos or zipf != r.zipf:
            conn.execute(sa.text("UPDATE dictionary_entries SET pos = :pos, zipf = :zipf WHERE id = :id"), {"pos": pos, "zipf": zipf, "id": r.id})
            pos_set += pos != r.pos
            zipf_set += zipf != r.zipf
    conn.execute(sa.text(
        "UPDATE dictionary_entries SET source = CASE WHEN audio_file IS NOT NULL OR NOT EXISTS "
        "(SELECT 1 FROM dictionary_examples x WHERE x.entry_id = dictionary_entries.id) THEN 'import' ELSE 'game' END WHERE source IS NULL"))
    return {"pos": pos_set, "zipf": zipf_set}


def upgrade() -> None:
    with op.batch_alter_table("dictionary_entries") as batch:
        batch.add_column(sa.Column("pos", sa.String(length=16), nullable=True))
        batch.add_column(sa.Column("zipf", sa.Float(), nullable=True))
        batch.add_column(sa.Column("source", sa.String(length=8), nullable=True))
        batch.add_column(sa.Column("meaning_edited", sa.Boolean(), nullable=False, server_default="0"))
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("dictionary_mode", sa.String(length=8), nullable=False, server_default="auto"))
    with op.batch_alter_table("dictionary_examples") as batch:
        batch.alter_column("song_id", existing_type=sa.Integer(), nullable=True)  # an example the user typed has no song
    backfill(op.get_bind())


def downgrade() -> None:
    op.execute("DELETE FROM dictionary_examples WHERE song_id IS NULL")
    with op.batch_alter_table("dictionary_examples") as batch:
        batch.alter_column("song_id", existing_type=sa.Integer(), nullable=False)
    with op.batch_alter_table("users") as batch:
        batch.drop_column("dictionary_mode")
    with op.batch_alter_table("dictionary_entries") as batch:
        batch.drop_column("meaning_edited")
        batch.drop_column("source")
        batch.drop_column("zipf")
        batch.drop_column("pos")
