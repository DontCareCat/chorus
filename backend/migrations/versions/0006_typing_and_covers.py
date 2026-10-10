"""typing game mode and stored album covers

Revision ID: 0006
Revises: 0005

games.mode ('choice' | 'typing'); game_answers may hold a typed answer instead of a chosen option;
songs.cover_source / cover_file point to a cover found online and kept in the covers folder.
"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("games") as batch:
        batch.add_column(sa.Column("mode", sa.String(8), nullable=False, server_default="choice"))
    with op.batch_alter_table("game_answers") as batch:
        batch.alter_column("selected_option_id", existing_type=sa.Integer(), nullable=True)
        batch.add_column(sa.Column("typed_text", sa.String(100), nullable=True))
        batch.add_column(sa.Column("match", sa.String(8), nullable=True))
    with op.batch_alter_table("songs") as batch:
        batch.add_column(sa.Column("cover_source", sa.String(16), nullable=True))
        batch.add_column(sa.Column("cover_file", sa.String(100), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("songs") as batch:
        batch.drop_column("cover_file")
        batch.drop_column("cover_source")
    # typed answers have no option to point at: they cannot exist in the old schema
    op.execute(sa.text("DELETE FROM game_answers WHERE game_id IN (SELECT id FROM games WHERE mode = 'typing')"))
    op.execute(sa.text("DELETE FROM games WHERE mode = 'typing'"))
    with op.batch_alter_table("game_answers") as batch:
        batch.drop_column("match")
        batch.drop_column("typed_text")
        batch.alter_column("selected_option_id", existing_type=sa.Integer(), nullable=False)
    with op.batch_alter_table("games") as batch:
        batch.drop_column("mode")
