"""several blanks per line, embedded covers, hidden (removed) songs

Revision ID: 0002
Revises: 0001

Questions change meaning (difficulty = share of the lyrics' words, several blanks per line), so cached
questions and the games that used them are cleared; songs, lyrics and the lyrics cache are kept.
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

OLD_COLUMNS = {"lyrics_id", "difficulty", "lyric_line_id"}
# gives the (unnamed) unique constraint of SQLite a name so batch mode can drop it
NAMING = {"uq": "uq_%(table_name)s_%(column_0_N_name)s"}


def _old_unique_name(bind) -> str | None:
    for uc in sa.inspect(bind).get_unique_constraints("questions"):
        if set(uc["column_names"]) == OLD_COLUMNS:
            return uc["name"] or "uq_questions_lyrics_id_difficulty_lyric_line_id"
    return None


def upgrade() -> None:
    bind = op.get_bind()
    old_name = _old_unique_name(bind)

    # cached questions use the old scheme: clear them together with everything that references them
    for table in ("game_answers", "games", "question_options", "questions"):
        op.execute(sa.text(f"DELETE FROM {table}"))

    with op.batch_alter_table("songs") as batch:
        batch.add_column(sa.Column("removed", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("has_cover", sa.Boolean(), nullable=True))

    with op.batch_alter_table("questions", naming_convention=NAMING) as batch:
        batch.add_column(sa.Column("blank_index", sa.Integer(), nullable=False, server_default="0"))
        if old_name:
            batch.drop_constraint(old_name, type_="unique")
        batch.create_unique_constraint("uq_question_blank", ["lyrics_id", "difficulty", "lyric_line_id", "blank_index"])


def downgrade() -> None:
    for table in ("game_answers", "games", "question_options", "questions"):
        op.execute(sa.text(f"DELETE FROM {table}"))
    with op.batch_alter_table("questions", naming_convention=NAMING) as batch:
        batch.drop_constraint("uq_question_blank", type_="unique")
        batch.drop_column("blank_index")
        batch.create_unique_constraint("uq_questions_lyrics_id_difficulty_lyric_line_id", ["lyrics_id", "difficulty", "lyric_line_id"])
    with op.batch_alter_table("songs") as batch:
        batch.drop_column("has_cover")
        batch.drop_column("removed")
