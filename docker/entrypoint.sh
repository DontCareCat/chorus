#!/bin/sh
# Update the database schema (waiting for MySQL if that is the configured database), then start the server.
set -e
uv run --no-sync python -m app.launcher migrate
exec uv run --no-sync python -m app.launcher serve --host 0.0.0.0 --port 8000
