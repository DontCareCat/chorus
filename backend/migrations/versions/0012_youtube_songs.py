"""songs played from YouTube: no file, a video id

Revision ID: 0012
Revises: 0011
"""
import sqlalchemy as sa
from alembic import op

from app.db.models.types import UTCDateTime

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("songs") as b:
        b.add_column(sa.Column("youtube_id", sa.String(16), nullable=True))
        b.add_column(sa.Column("youtube_channel", sa.String(300), nullable=True))
        b.add_column(sa.Column("youtube_checked_at", UTCDateTime(), nullable=True))
        b.alter_column("file_path", existing_type=sa.String(1000), nullable=True)
        b.alter_column("file_name", existing_type=sa.String(300), nullable=True)
        b.create_unique_constraint("uq_songs_youtube_id", ["youtube_id"])


def downgrade() -> None:
    if op.get_bind().execute(sa.text("SELECT 1 FROM songs WHERE source = 'youtube' LIMIT 1")).first():
        raise RuntimeError("Remove the YouTube songs before downgrading: older versions cannot read them")
    with op.batch_alter_table("songs") as b:
        b.drop_constraint("uq_songs_youtube_id", type_="unique")
        b.drop_column("youtube_checked_at")
        b.drop_column("youtube_channel")
        b.drop_column("youtube_id")
