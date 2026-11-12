"""dictionary entries keep the recording that came with an imported Anki deck

Revision ID: 0015
Revises: 0014
"""
import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("dictionary_entries") as batch:
        batch.add_column(sa.Column("audio_file", sa.String(length=64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("dictionary_entries") as batch:
        batch.drop_column("audio_file")
