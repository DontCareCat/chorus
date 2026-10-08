from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import games, lyrics, settings, songs
from app.core.config import settings as env
from app.core.errors import (
    AppError, app_error_handler, http_error_handler, unhandled_error_handler, validation_error_handler,
)
from app.core.logging import configure_logging


def mount_frontend(app: FastAPI, dist_dir: str) -> bool:
    """Serve the built frontend (production: one process, one port). API routes win: this mount comes last."""
    if dist_dir and (Path(dist_dir) / "index.html").is_file():
        app.mount("/", StaticFiles(directory=dist_dir, html=True), name="frontend")
        return True
    return False


def create_app(frontend_dist: str = "") -> FastAPI:
    configure_logging()
    app = FastAPI(title="Chorus")
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)
    app.include_router(songs.router)
    app.include_router(lyrics.router)
    app.include_router(games.router)
    app.include_router(settings.router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    mount_frontend(app, frontend_dist)
    return app


app = create_app(env.frontend_dist)
