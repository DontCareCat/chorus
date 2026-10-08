# Chorus

Learn a language by filling in the missing words of the songs you listen to.

Add songs from your own music folders. Chorus finds synchronized lyrics for them, turns the lyrics into fill-the-blank questions, and plays the song while you answer. You can answer **ahead of the music**; if the audio gets more than three seconds past the first question you have not answered, it fades out, rewinds to the previous line and waits for you.

> **Private-use software.** Run Chorus on your own computer, or on a network you trust. Without an account everybody is the shared *Guest*; accounts keep games and scores apart (see [Accounts and scores](#accounts-and-scores)). See [Legal notes](#legal-notes).

## What it does

- **Library**: scan folders (files are used where they are, never modified), import a file or a whole folder (optionally with subfolders), or upload files. Embedded cover art is shown.
- **Lyrics**: found automatically (a `.lrc` file next to the song, then [LRCLIB](https://lrclib.net)); if there is no confident match you can search by hand or upload a `.lrc` / text file. Saved lyrics can be replaced at any time: *Search again* lists the candidates (the ones in use are marked) and never swaps anything by itself; games already started keep their lyrics. Lyrics are cached. You can nudge the timing and preview it against the audio.
- **Game**: choose how much of the song is asked: easy 10%, medium 30%, hard 60%, expert 80% of the words. A line can have several blanks; the sentence hides all of them so one answer never reveals another.
- **Playback**: play / pause / stop, back 5 seconds, a seekable timeline, volume (desktop). The *timeline* at the top shows your questions, the audio, and where the audio will stop and wait for you. The lyrics scroll past as a *window*: the line being sung is a little larger and brighter, the others fade with distance, timecodes sit quietly on the left, and answered words show the right word in green (you had it) or red (you did not), right inside the line.
- **Score**: every right answer earns 10 points, +15 if you answered *ahead* of the music (before its line starts), all multiplied by a streak multiplier: every 4 right answers in a row add a level, x2 up to x8. A wrong answer resets it. While the audio waits for you, a countdown eats one level every 5 seconds.
- **Accounts**: sign in with a name and password, or just play as the shared *Guest*. Each account has its own games and scores; the library is shared.
- **Look**: light and dark themes (switch in the header), one monospaced typeface.
- Works with **SQLite** (default) or **MySQL**, chosen by one setting.

## Run it

Pick one. All of them are the same app and the same database format.

| | For | You need |
|---|---|---|
| [Desktop app](#desktop-app-windows-and-macos) | your own Windows / macOS computer | nothing, just download |
| [Linux server, no Docker](#linux-server-without-docker) | an always-on Linux box | nothing (bundled), or Python + Node to build from source |
| [Docker Compose](#with-docker-chorus--mysql) | a server with Docker, MySQL included | Docker |
| [From source](#from-source-without-docker) | any OS, development | Python 3.12+ with [uv](https://docs.astral.sh/uv/), Node 20+ |

### Desktop app (Windows and macOS)

Download from the [Releases](../../releases) page: `Chorus-Setup-x.y.z.exe` (or the portable `.zip`) for Windows, `Chorus-x.y.z-macos-arm64.dmg` / `-macos-x64.dmg` for macOS. Start it and a Chorus icon appears in the system tray (menu bar on macOS) and your browser opens the app. Closing the browser tab does not stop Chorus; use the tray menu to quit.

The apps are **not code-signed**, so the first start shows a warning:
- macOS: drag Chorus to Applications, then right-click it and choose **Open** once (or run `xattr -dr com.apple.quarantine /Applications/Chorus.app`).
- Windows: SmartScreen says "unknown publisher": **More info**, then **Run anyway**.

**Your data is never inside the app.** The library, lyrics cache, uploads and settings live in your user folder, so you can copy, share or delete the app without taking your music library along:

| | Location |
|---|---|
| Windows | `%APPDATA%\Chorus` |
| macOS | `~/Library/Application Support/Chorus` |

It holds `app.db`, `media/`, `chorus.log` and `config.toml`. Uninstalling keeps it.

Tray menu: **Open Chorus**, **Allow connections from other devices**, **Open config file**, **Open data folder**, **Start at login**, **Quit**.

By default Chorus listens on `127.0.0.1:8765`: only this computer can reach it. Change that in `config.toml` (restart Chorus afterwards), or with the tray checkbox for remote access:

```toml
port = 8765            # any free port
allow_remote = false   # true = other devices on your network can connect (http://<this computer>:8765)
# host = "192.168.1.20"   # or listen on one specific address (wins over allow_remote)
```

Environment variables (`CHORUS_PORT`, `CHORUS_HOST`, `CHORUS_ALLOW_REMOTE`, `CHORUS_DATA_DIR`) and command-line options (`--port`, `--allow-remote`, `--data-dir`) override the file. **With remote access on, anyone on that network can use Chorus as Guest, scan your folders and play your files, until you create an account and switch guest access off in Settings** (see [Accounts and scores](#accounts-and-scores)).

### Linux server without Docker

Download `chorus-x.y.z-linux-x64.tar.gz` from [Releases](../../releases). It holds a self-contained build, a systemd unit and `INSTALL.md`:

```bash
mkdir chorus-pkg && tar xzf chorus-*-linux-x64.tar.gz -C chorus-pkg && cd chorus-pkg
sudo mkdir -p /opt/chorus /etc/chorus && sudo cp -r chorus/. /opt/chorus/
sudo cp chorus.service /etc/systemd/system/ && sudo cp chorus.env.example /etc/chorus/chorus.env
sudo systemctl daemon-reload && sudo systemctl enable --now chorus
```

It listens on `127.0.0.1:8000` until you change `CHORUS_HOST` in `/etc/chorus/chorus.env`; data lives in `/var/lib/chorus`. Or run it from source (below) under your own supervisor.

### With Docker (Chorus + MySQL)

```bash
cp .env.example .env          # then edit: passwords, and MUSIC_DIR (your music folder)
docker compose up -d --build
```

Open <http://localhost:8000>, then press **Scan folders** (your `MUSIC_DIR` is mounted read-only at `/music`). A prebuilt image is published with each release: `ghcr.io/dontcarecat/chorus:<version>` (SQLite in `/data` unless you set `DATABASE_URL`).

By default it listens on this computer only. To reach it from other devices, set `CHORUS_BIND=0.0.0.0` in `.env`: **anyone on that network can then use it**, including scanning and importing from the mounted folders.

Data lives in two volumes: `mysql-data` (database) and `chorus-data` (copies of uploaded/imported songs).

### From source without Docker

```bash
cd frontend && npm ci && npm run build && cd ..      # once, and after frontend changes
cd backend && uv sync
uv run python -m app.launcher serve                   # http://127.0.0.1:8000, migrates the database first
```

This is the regular, single-process start: the backend serves the built frontend. It keeps its data in the current folder (`backend/app.db`, `backend/media/`) unless you pass `--data-dir DIR` / `CHORUS_DATA_DIR`. Useful options: `--port 9000`, `--allow-remote` (listen on all interfaces), `--frontend DIR`. `uv run python -m app.launcher tray` (after `uv sync --group desktop`) starts the tray app from source.

### For development (hot reload)

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

## Accounts and scores

- **Guest** is the default: nobody has to sign in. Guests share one identity (and one set of games).
- **Create an account** from *Sign in*. The **first account administers the server**: it can switch *guest access* and *new accounts* off in Settings and delete accounts. Passwords are stored as salted scrypt hashes, session cookies as digests, and repeated wrong passwords are slowed down.
- **Privacy**: games, answers and scores belong to their account (somebody else's game link says the game does not exist). Songs, lyrics, library folders and settings are shared by everyone on the server.
- **Remote access**: with *guest access* off, everybody has to sign in first. Chorus does not encrypt traffic; use only trusted networks or an HTTPS reverse proxy.
- **Scoring rules** (the server decides, the page only shows them): 10 points per right answer, +15 when answered ahead of the playhead, x(multiplier). Multiplier = 1 + one level per 4 right answers in a row, up to x8. Wrong answer: 0 points, back to x1. Every 5 s the audio spent waiting for an answer costs one level (progress to the next level is cleared). Old games keep their results (each right answer counted 10 points).

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
packaging/  PyInstaller spec, Windows installer script, Linux systemd unit, smoke test
.github/    CI (tests) and the release workflow
```

## Releases

Bump `__version__` in `backend/app/__init__.py` **and** `version` in `backend/pyproject.toml` (a test keeps them equal), commit, then:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

The *Release* workflow tests, builds the Windows installer and zip, the two macOS disk images and the Linux archive, smoke-tests each build (starts it, uploads a song and lyrics, generates a game), pushes the multi-architecture Docker image to GitHub Container Registry and publishes a GitHub release with checksums. A tag with a dash (`v0.2.0-rc1`) makes a pre-release and does not move the `latest` image. *Run workflow* on the Actions tab builds everything without publishing, which is the way to try a change to the packaging.

## Legal notes

- Music and lyrics are **copyrighted** by their owners. Chorus is for your own library and your own study. The lyrics it downloads are stored in your database and cache; **do not redistribute** them, the database, or the stored audio.
- Lyrics come from the community service **LRCLIB**. Chorus identifies itself in its requests, caches what it fetches and never bulk-downloads. Be a good citizen of that service.
- Audio is played only from files you provide; nothing is downloaded from streaming sites.
- Accounts separate people's games and scores, but the library, lyrics and audio are shared, and Chorus has no encryption of its own. Do not expose it to the internet; behind a reverse proxy, use HTTPS.
