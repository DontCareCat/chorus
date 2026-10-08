#!/bin/sh
# Apply database migrations (waiting for MySQL if that is the configured database), then start the server.
set -e
tries=0
until uv run --no-sync alembic upgrade head; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then
    echo "The database did not become ready after 30 attempts; giving up." >&2
    exit 1
  fi
  echo "Database not ready yet (attempt $tries/30), retrying in 3 s..." >&2
  sleep 3
done
exec uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port 8000
