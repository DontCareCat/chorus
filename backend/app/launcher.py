"""Command line entry point.

    python -m app.launcher serve     headless server (Linux server, running from source, Docker)
    python -m app.launcher tray      desktop app: server + tray icon + browser (what the packaged app runs by default)
    python -m app.launcher migrate   only bring the database schema up to date

The data directory (database, uploaded media, log, config.toml) is decided here, before `app.core.config` is
imported, because the settings object reads the environment once at import time.
"""
import argparse
import json
import logging
import os
import socket
import sys
import urllib.request
import webbrowser
from collections.abc import MutableMapping
from pathlib import Path

from app import __version__
from app.desktop import userconfig

DEFAULT_SERVE_PORT = 8000
DEFAULT_TRAY_PORT = 8765  # not 8000/5173, so the app never collides with a development instance
LOG_FILE = "chorus.log"

log = logging.getLogger("chorus")


def prepare_stdio() -> None:
    """Windowed builds have no stdout/stderr; libraries that write to them (uvicorn, tracebacks) would crash."""
    for name in ("stdout", "stderr"):
        if getattr(sys, name) is None:
            setattr(sys, name, open(os.devnull, "w", encoding="utf-8"))


def prepare_environment(
    data_dir_arg: str | None, *, tray: bool, env: MutableMapping[str, str] = os.environ
) -> Path | None:
    """Point the database and media settings at the data directory, unless the user set them explicitly."""
    raw = data_dir_arg or env.get("CHORUS_DATA_DIR")
    if raw:
        data_dir = Path(raw).expanduser().resolve()
    elif tray:
        data_dir = userconfig.default_data_dir()
    else:
        return None  # plain `serve`: keep the working-directory defaults of app.core.config
    (data_dir / "media").mkdir(parents=True, exist_ok=True)
    env.setdefault("DATABASE_URL", f"sqlite:///{(data_dir / 'app.db').as_posix()}")
    env.setdefault("MEDIA_DIR", str(data_dir / "media"))
    return data_dir


def find_frontend(explicit: str | None, env: MutableMapping[str, str] = os.environ) -> str:
    """The built frontend: --frontend, FRONTEND_DIST, the packaged bundle, or ../frontend/dist next to backend/."""
    from app.db.migrate import backend_root

    candidates = [explicit, env.get("FRONTEND_DIST"), str(backend_root() / "frontend-dist"),
                  str(backend_root().parent / "frontend" / "dist")]
    for candidate in candidates:
        if candidate and (Path(candidate) / "index.html").is_file():
            return str(Path(candidate).resolve())
    return ""


def chorus_running(port: int, timeout: float = 1.5) -> bool:
    """Is a Chorus already answering on this port of this computer?"""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=timeout) as response:
            return json.load(response).get("app") == "chorus"
    except (OSError, ValueError, AttributeError):
        return False


def port_is_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def free_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return sock.getsockname()[1]


def _network(args: argparse.Namespace, data_dir: Path | None, default_port: int) -> userconfig.Network:
    config = userconfig.read_config(data_dir / userconfig.CONFIG_FILE if data_dir else None)
    return userconfig.resolve_network(
        default_port=default_port, cli_host=args.host, cli_port=args.port,
        cli_allow_remote=args.allow_remote, config=config,
    )


def _setup(args: argparse.Namespace, *, tray: bool) -> tuple[Path | None, str]:
    frontend = find_frontend(args.frontend)  # before chdir: --frontend may be relative
    data_dir = prepare_environment(args.data_dir, tray=tray)
    if data_dir:
        os.chdir(data_dir)  # stray relative paths and a .env land in the user's folder, never next to the app
    if frontend:
        os.environ["FRONTEND_DIST"] = frontend
    return data_dir, frontend


def cmd_migrate(args: argparse.Namespace) -> int:
    _setup(args, tray=False)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    from app.db.migrate import upgrade_to_head

    upgrade_to_head()
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    prepare_stdio()
    data_dir, frontend = _setup(args, tray=False)
    net = _network(args, data_dir, DEFAULT_SERVE_PORT)
    from app.core.logging import configure_logging

    configure_logging()
    from app.db.migrate import upgrade_to_head

    upgrade_to_head()
    if not frontend:
        log.warning("No built frontend found: serving the API only (build it with `npm run build` in frontend/).")
    if net.remote:
        log.warning("Listening on %s: anyone who can reach this port can use Chorus (there is no login).", net.host)
    import uvicorn

    from app.main import app

    uvicorn.run(app, host=net.host, port=net.port, log_level="info")
    return 0


def cmd_tray(args: argparse.Namespace) -> int:
    data_dir, _ = _setup(args, tray=True)
    assert data_dir is not None
    from app.desktop import tray

    prepare_stdio()
    tray.configure_file_logging(data_dir / LOG_FILE)
    log.info("Chorus %s, data in %s", __version__, data_dir)

    net = _network(args, data_dir, DEFAULT_TRAY_PORT)
    if chorus_running(net.port):
        log.info("Chorus is already running on port %d; opening it.", net.port)
        webbrowser.open(f"http://localhost:{net.port}")
        return 0
    if not port_is_free(net.host, net.port):
        if net.port_explicit:
            tray.show_error(f"Port {net.port} is already used by another program. Change `port` in "
                            f"{data_dir / userconfig.CONFIG_FILE} (or stop the other program) and start Chorus again.")
            return 1
        net = userconfig.Network(net.host, free_port(net.host), False)
        log.warning("Default port %d is busy; using %d.", DEFAULT_TRAY_PORT, net.port)
    try:
        from app.db.migrate import upgrade_to_head

        upgrade_to_head(retries=1)
    except Exception as exc:  # noqa: BLE001 - the user has no console; report it where they can see it
        log.exception("Database migration failed")
        tray.show_error(f"Chorus could not prepare its database in {data_dir}:\n{exc}")
        return 1
    return tray.run(net, data_dir, lambda: _network(args, data_dir, DEFAULT_TRAY_PORT))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="chorus", description="Chorus: learn a language through songs.")
    parser.add_argument("--version", action="version", version=f"chorus {__version__}")
    sub = parser.add_subparsers(dest="command")
    for name, help_text in (("serve", "run the server"), ("tray", "run the desktop app (tray icon)"),
                            ("migrate", "update the database schema and exit")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--data-dir", help="folder for the database, uploaded media, log and config.toml "
                                          "(env CHORUS_DATA_DIR)")
        p.add_argument("--host", help="address to listen on (env CHORUS_HOST; default 127.0.0.1)")
        p.add_argument("--port", type=int, help="port (env CHORUS_PORT)")
        p.add_argument("--allow-remote", action="store_true", default=None,
                       help="listen on all interfaces so other devices can connect (env CHORUS_ALLOW_REMOTE)")
        p.add_argument("--frontend", help="folder of the built frontend (env FRONTEND_DIST)")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    command = args.command
    if command is None:
        if not (getattr(sys, "frozen", False) and sys.platform in ("win32", "darwin")):
            parser.print_help()
            return 2
        args = parser.parse_args(["tray"])  # the packaged app started by double-click
        command = "tray"
    return {"serve": cmd_serve, "tray": cmd_tray, "migrate": cmd_migrate}[command](args)


if __name__ == "__main__":
    sys.exit(main())
