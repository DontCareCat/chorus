"""playlists and their songs

Revision ID: 0011
Revises: 0010
"""
import sqlalchemy as sa
from alembic import op

from app.db.models.types import UTCDateTime

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "playlists",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "name", name="uq_playlist_name"),
    )
    op.create_index("ix_playlists_user_id", "playlists", ["user_id"])
    op.create_table(
        "playlist_songs",
        sa.Column("playlist_id", sa.Integer(), sa.ForeignKey("playlists.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("song_id", sa.Integer(), sa.ForeignKey("songs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("added_at", UTCDateTime(), nullable=False),
    )
    op.create_index("ix_playlist_songs_song_id", "playlist_songs", ["song_id"])


def downgrade() -> None:
    op.drop_table("playlist_songs")
    op.drop_table("playlists")
