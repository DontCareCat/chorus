import logging

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger(__name__)


class AppError(Exception):
    """Structured error returned to the frontend as {"error": {"code", "message"}}."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content=_body(exc.code, exc.message))


def _field(loc: tuple) -> str:
    parts = [str(p) for p in loc if p not in ("body", "query", "path")]
    return ".".join(parts)


async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPI's own 422 → the same shape as every other error, with a message a person can act on."""
    first = exc.errors()[0] if exc.errors() else {}
    field = _field(tuple(first.get("loc", ())))
    detail = str(first.get("msg", "Invalid request"))
    message = f"{field}: {detail}" if field else detail
    return JSONResponse(status_code=422, content=_body("invalid_request", message))


async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    """404 for an unknown path, 405 for a wrong method, ... in the same shape."""
    messages = {404: "Not found", 405: "Method not allowed"}
    message = messages.get(exc.status_code) or str(exc.detail)
    return JSONResponse(status_code=exc.status_code, content=_body(f"http_{exc.status_code}", message))


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Anything unexpected: logged with its traceback, but the response never leaks internals."""
    log.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content=_body("internal_error", "Something went wrong on the server. See the server log."))
