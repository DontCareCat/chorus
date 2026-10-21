"""Dictionary words are looked up again: the first lookup ignored the part of speech (verbs got noun articles, numerals "die", ...)

Revision ID: 0010
Revises: 0009

Only what was derived from the outside services is cleared (lemma, article, word translation; the sentence translations are fine); the words, their example lines and the
review schedule stay. The words are marked pending and finish in the background.
"""
import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text(
        "UPDATE dictionary_entries SET lemma = NULL, article = NULL, translation = NULL, translation_language = NULL, enrich_status = 'pending'"))
    op.execute(sa.text("DELETE FROM dictionary_cache WHERE cache_key LIKE 'wk:%'"))


def downgrade() -> None:
    pass  # the cleared values are fetched again; nothing to restore
