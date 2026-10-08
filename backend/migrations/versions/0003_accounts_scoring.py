"""accounts (users, sessions) and scoring (points, streak, multiplier)

Revision ID: 0003
Revises: 0002

Existing games are given to the built-in Guest. Their score used to be the number of correct answers; it becomes
points (10 per correct answer), the old number is kept as correct_count.
"""
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    users = op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(64), nullable=False),
        sa.Column("display_name", sa.String(64), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("is_guest", sa.Boolean(), nullable=False),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("username"),
    )
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])

    op.bulk_insert(users, [{
        "username": "guest", "display_name": "Guest", "password_hash": None,
        "is_guest": True, "is_admin": False, "created_at": datetime.now(timezone.utc).replace(tzinfo=None),
    }])
    guest_id = op.get_bind().execute(sa.text("SELECT id FROM users WHERE username = 'guest'")).scalar_one()

    with op.batch_alter_table("games") as batch:
        batch.add_column(sa.Column("correct_count", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("streak", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("multiplier", sa.Integer(), nullable=False, server_default="1"))
        batch.add_column(sa.Column("best_multiplier", sa.Integer(), nullable=False, server_default="1"))
    op.execute(sa.text("UPDATE games SET correct_count = score, score = score * 10"))
    op.execute(sa.text("UPDATE games SET user_id = :g WHERE user_id IS NULL").bindparams(g=guest_id))
    with op.batch_alter_table("games") as batch:
        batch.alter_column("user_id", existing_type=sa.Integer(), nullable=False)
        batch.create_foreign_key("fk_games_user_id", "users", ["user_id"], ["id"])
        batch.create_index("ix_games_user_id", ["user_id"])

    with op.batch_alter_table("game_answers") as batch:
        batch.add_column(sa.Column("points", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("ahead", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("multiplier", sa.Integer(), nullable=False, server_default="1"))
    op.execute(sa.text("UPDATE game_answers SET points = 10 WHERE is_correct = :t").bindparams(t=True))


def downgrade() -> None:
    with op.batch_alter_table("game_answers") as batch:
        batch.drop_column("multiplier")
        batch.drop_column("ahead")
        batch.drop_column("points")
    op.execute(sa.text("UPDATE games SET score = correct_count"))
    with op.batch_alter_table("games") as batch:
        batch.drop_constraint("fk_games_user_id", type_="foreignkey")
        batch.drop_index("ix_games_user_id")  # after the foreign key: MySQL needs the index while the key exists
        batch.alter_column("user_id", existing_type=sa.Integer(), nullable=True)
        batch.drop_column("best_multiplier")
        batch.drop_column("multiplier")
        batch.drop_column("streak")
        batch.drop_column("correct_count")
    op.drop_table("user_sessions")
    op.drop_table("users")
