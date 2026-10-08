# Chorus

Learn a language by filling in the missing words of the songs you listen to.

Add songs from your own music folders. Chorus finds synchronized lyrics for them, turns the lyrics into fill-the-blank questions, and plays the song while you answer. You can answer **ahead of the music**; if the audio gets more than three seconds past the first question you have not answered, it fades out, rewinds to the previous line and waits for you.

> **Private-use software.** Chorus has no login. Run it on your own computer, or on a network you trust. See [Legal notes](#legal-notes).

## What it does

- **Library**: scan folders (files are used where they are, never modified), import a file or a whole folder (optionally with subfolders), or upload files. Embedded cover art is shown.
- **Lyrics**: found automatically (a `.lrc` file next to the song, then [LRCLIB](https://lrclib.net)); if there is no confident match you can search by hand or upload a `.lrc` / text file. Lyrics are cached. You can nudge the timing and preview it against the audio.
- **Game**: choose how much of the song is asked: easy 10%, medium 30%, hard 60%, expert 80% of the words. A line can have several blanks; the sentence hides all of them so one answer never reveals another.
- **Playback**: play / pause / stop, back 5 seconds, a seekable timeline, volume (desktop). The *runway* at the top shows your questions, the audio, and where the audio will stop and wait for you.
- Works with **SQLite** (default) or **MySQL**, chosen by one setting.

## Run it

### With Docker (Chorus + MySQL)

```bash
cp .env.example .env          # then edit: passwords, and MUSIC_DIR (your music folder)
docker compose up -d --build
```

Open <http://localhost:8000>, then press **Scan folders** (your `MUSIC_DIR` is mounted read-only at `/music`).

By default it listens on this computer only. To reach it from other devices, set `CHORUS_BIND=0.0.0.0` in `.env`: **anyone on that network can then use it**, including scanning and importing from the mounted folders.

Data lives in two volumes: `mysql-data` (database) and `chorus-data` (copies of uploaded/imported songs).

### For development (SQLite, hot reload)

You need Python 3.12+ with [uv](https://docs.astral.sh/uv/), and Node 20+.

```bash
# terminal 1: backend
cd backend
uv sync
uv run alembic upgrade head
LIBRARY_DIRS=~/Music uv run uvicorn app.main:app --port 8000

# terminal 2: frontend (proxies /api to the backend)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

To open the dev server to your network: `npm run dev -- --host 0.0.0.0` (only the frontend is exposed; it forwards `/api` to the backend on localhost). Point it at another backend with `CHORUS_API=http://host:port`.

## Settings

Environment variables (backend; also in a `backend/.env` file):

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./app.db` | `mysql+pymysql://user:password@host/db?charset=utf8mb4` for MySQL. Nothing else changes. |
| `MEDIA_DIR` | `./media` | where uploaded / imported copies of songs are stored |
| `LIBRARY_DIRS` | *(empty)* | comma-separated folders to scan (first-run default of the setting below) |
| `MAX_UPLOAD_MB` | `500` | size limit for one uploaded file |
| `LRCLIB_BASE_URL` | `https://lrclib.net/api` | lyrics service |
| `FRONTEND_DIST` | *(empty)* | folder of the built frontend to serve (the Docker image sets it) |

Settings page (stored in the database): allow unsynchronized lyrics, look up lyrics automatically, default language for new songs, how long downloaded lyrics are cached (or forever), library folders.

## Good to know

- **Language**: questions are generated in the language of the lyrics, which you set per song (default `de`). Languages written without spaces (Japanese, Chinese, Thai) are not supported yet.
- **Question quality**: distractors are chosen by word length, ending and frequency; there is no part-of-speech tagging, so a wrong-looking word type can slip in.
- **Unsynchronized lyrics** (plain text) can be allowed in Settings. The game then runs in *free play*: the audio never waits for you.
- **Word timing** is not available from LRCLIB, only line timing. That is why the rule works per line.
- Songs that are only *hidden* (removed from a scanned folder) stay on disk and are not re-added by a scan; importing the file again brings them back.

## Tests

```bash
cd backend && uv run pytest                         # SQLite, in memory
cd backend && TEST_DATABASE_URL='mysql+pymysql://chorus:chorus@127.0.0.1:3307/chorus?charset=utf8mb4' uv run pytest   # MySQL
cd frontend && npm test && npm run typecheck
```

`frontend/e2e/` holds real-browser checks (Playwright, headless Chromium) that measure real fades and volume through the Web Audio graph; see the header of each script for how to run them.

## Project layout

```text
backend/    FastAPI + SQLAlchemy + Alembic (library, lyrics, questions, games)
frontend/   React + TypeScript + Vite (the game, playback engine, synchronization rules)
docker/     Dockerfile and entrypoint
```

## Legal notes

- Music and lyrics are **copyrighted** by their owners. Chorus is for your own library and your own study. The lyrics it downloads are stored in your database and cache; **do not redistribute** them, the database, or the stored audio.
- Lyrics come from the community service **LRCLIB**. Chorus identifies itself in its requests, caches what it fetches and never bulk-downloads. Be a good citizen of that service.
- Audio is played only from files you provide; nothing is downloaded from streaming sites.
- There is **no authentication**. Do not expose Chorus to the internet.
