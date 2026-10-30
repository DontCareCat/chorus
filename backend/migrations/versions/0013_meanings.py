"""Words saved without a meaning are looked up again: a word already in the translation language (or returned unchanged) now gets a definition

Revision ID: 0013
Revises: 0012

Nothing is cleared; the words are only marked pending and finish in the background.
"""
import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE dictionary_entries SET enrich_status = 'pending' WHERE enrich_status = 'done' AND translation IS NULL"))


def downgrade() -> None:
    pass
