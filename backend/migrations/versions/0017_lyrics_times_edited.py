"""a song keeps the lyric line times its owner edited (the lyrics themselves are never changed)

Revision ID: 0017
Revises: 0016

songs.lyrics_times_edited: JSON array, one start time (seconds, or null) per line of the active lyrics; null = not edited.
songs.lyrics_times_edited_at: when it was saved.
"""
import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("songs") as batch:
        batch.add_column(sa.Column("lyrics_times_edited", sa.Text(), nullable=True))
        batch.add_column(sa.Column("lyrics_times_edited_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("songs") as batch:
        batch.drop_column("lyrics_times_edited_at")
        batch.drop_column("lyrics_times_edited")
