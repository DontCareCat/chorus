"""songs.language_source: where a song's language came from

Revision ID: 0007
Revises: 0006

'default' (the setting's default language), 'detected' (guessed from the lyrics) or 'manual' (chosen by a person).
Songs that exist already count as 'manual': whatever language they have is left alone.
"""
import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("songs") as batch:
        batch.add_column(sa.Column("language_source", sa.String(16), nullable=False, server_default="default"))
    op.execute(sa.text("UPDATE songs SET language_source = 'manual'"))


def downgrade() -> None:
    with op.batch_alter_table("songs") as batch:
        batch.drop_column("language_source")
