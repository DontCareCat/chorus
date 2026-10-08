"""generated question sets are versioned

Revision ID: 0004
Revises: 0003

The generator now spreads questions evenly over the whole song (version 2). Games that already exist keep the
questions they began with (version 1), so nothing is deleted: new games simply ask for version 2.
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

NAMING = {"uq": "uq_%(table_name)s_%(column_0_N_name)s"}


def upgrade() -> None:
    with op.batch_alter_table("questions", naming_convention=NAMING) as batch:
        batch.add_column(sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
        batch.drop_constraint("uq_question_blank", type_="unique")
        batch.create_unique_constraint("uq_question_blank", ["lyrics_id", "difficulty", "version", "lyric_line_id", "blank_index"])
    with op.batch_alter_table("games") as batch:
        batch.add_column(sa.Column("question_version", sa.Integer(), nullable=False, server_default="1"))


def downgrade() -> None:
    # The old schema has one question set per lyrics and difficulty: games on newer sets cannot be kept.
    for table in ("game_answers",):
        op.execute(sa.text(f"DELETE FROM {table} WHERE game_id IN (SELECT id FROM games WHERE question_version <> 1)"))
    op.execute(sa.text("DELETE FROM games WHERE question_version <> 1"))
    op.execute(sa.text("DELETE FROM question_options WHERE question_id IN (SELECT id FROM questions WHERE version <> 1)"))
    op.execute(sa.text("DELETE FROM questions WHERE version <> 1"))
    with op.batch_alter_table("games") as batch:
        batch.drop_column("question_version")
    with op.batch_alter_table("questions", naming_convention=NAMING) as batch:
        batch.drop_constraint("uq_question_blank", type_="unique")
        batch.create_unique_constraint("uq_question_blank", ["lyrics_id", "difficulty", "lyric_line_id", "blank_index"])
        batch.drop_column("version")
