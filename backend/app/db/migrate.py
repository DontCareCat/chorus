"""Run Alembic programmatically (the packaged app has no working directory with an alembic.ini next to it)."""
import logging
import sys
import time
from collections.abc import Callable
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.exc import OperationalError

log = logging.getLogger(__name__)


def backend_root() -> Path:
    """Folder holding `migrations/`: the PyInstaller bundle when frozen, otherwise the `backend/` folder."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parents[2]


def alembic_config() -> Config:
    config = Config()
    config.set_main_option("script_location", str(backend_root() / "migrations"))
    return config


def upgrade_to_head(retries: int = 30, delay: float = 3.0, sleep: Callable[[float], None] = time.sleep) -> None:
    """Migrate the configured database; wait for it to accept connections first (MySQL starting alongside us)."""
    for attempt in range(1, retries + 1):
        try:
            command.upgrade(alembic_config(), "head")
            return
        except OperationalError as exc:
            if attempt == retries:
                raise
            log.warning("Database not ready (attempt %d/%d): %s", attempt, retries, exc.orig or exc)
            sleep(delay)
