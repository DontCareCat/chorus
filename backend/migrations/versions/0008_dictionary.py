"""dictionary: words asked in games, their examples, a cache of lookups; users.translation_language

Revision ID: 0008
Revises: 0007
"""
import sqlalchemy as sa
from alembic import op

from app.db.models.types import UTCDateTime

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("translation_language", sa.String(16), nullable=False, server_default="en"))
    op.create_table(
        "dictionary_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("language", sa.String(16), nullable=False),
        sa.Column("word", sa.String(100), nullable=False),
        sa.Column("surface", sa.String(100), nullable=False),
        sa.Column("lemma", sa.String(100), nullable=True),
        sa.Column("article", sa.String(16), nullable=True),
        sa.Column("translation", sa.String(300), nullable=True),
        sa.Column("translation_language", sa.String(16), nullable=True),
        sa.Column("enrich_status", sa.String(8), nullable=False, server_default="pending"),
        sa.Column("suspended", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("added_at", UTCDateTime(), nullable=False),
        sa.Column("due_at", UTCDateTime(), nullable=True),
        sa.Column("interval_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reps", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lapses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("introduced_at", UTCDateTime(), nullable=True),
        sa.Column("last_reviewed_at", UTCDateTime(), nullable=True),
        sa.UniqueConstraint("user_id", "language", "word", name="uq_dictionary_word"),
    )
    op.create_index("ix_dictionary_entries_user_id", "dictionary_entries", ["user_id"])
    op.create_index("ix_dictionary_entries_due_at", "dictionary_entries", ["due_at"])
    op.create_table(
        "dictionary_examples",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("entry_id", sa.Integer(), sa.ForeignKey("dictionary_entries.id", ondelete="CASCADE"), nullable=False),
        sa.Column("song_id", sa.Integer(), sa.ForeignKey("songs.id"), nullable=False),
        sa.Column("sentence", sa.Text(), nullable=False),
        sa.Column("translation", sa.Text(), nullable=True),
        sa.Column("audio_start", sa.Float(), nullable=True),
        sa.Column("audio_end", sa.Float(), nullable=True),
    )
    op.create_index("ix_dictionary_examples_entry_id", "dictionary_examples", ["entry_id"])
    op.create_index("ix_dictionary_examples_song_id", "dictionary_examples", ["song_id"])
    op.create_table(
        "dictionary_cache",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cache_key", sa.String(120), nullable=False, unique=True),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("dictionary_cache")
    op.drop_table("dictionary_examples")
    op.drop_table("dictionary_entries")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("translation_language")
