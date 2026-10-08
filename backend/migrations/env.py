from alembic import context

from app.core.config import settings
from app.db import models  # noqa: F401  (register tables)
from sqlalchemy import create_engine

from app.db.database import Base

target_metadata = Base.metadata


def render_item(type_, obj, autogen_context):
    # Keep migrations independent of app code: UTCDateTime is a plain DateTime at the DB level.
    if type_ == "type" and obj.__class__.__name__ == "UTCDateTime":
        return "sa.DateTime()"
    return False


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url, target_metadata=target_metadata,
        literal_binds=True, render_as_batch=True, render_item=render_item,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # A plain engine: SQLite table rebuilds (batch mode) need foreign-key enforcement off while tables are swapped.
    engine = create_engine(settings.database_url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata,
            render_as_batch=True, render_item=render_item,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
