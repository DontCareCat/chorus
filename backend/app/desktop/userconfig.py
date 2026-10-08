"""Where the user's data lives, and the network settings shared by `chorus serve` and `chorus tray`.

Standard library only: this runs before the rest of the app is imported (the data directory decides the database
and media paths, which `app.core.config` reads at import time).

Precedence for every setting: command line > environment > config.toml (in the data directory) > default.
"""
import logging
import os
import sys
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

LOCAL_HOST = "127.0.0.1"
ANY_HOST = "0.0.0.0"
CONFIG_FILE = "config.toml"
_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}


def default_data_dir() -> Path:
    """Per-user directory, always outside the application directory (so sharing the app never shares the data)."""
    home = Path.home()
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA") or home / "AppData" / "Roaming") / "Chorus"
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "Chorus"
    return Path(os.environ.get("XDG_DATA_HOME") or home / ".local" / "share") / "chorus"


def read_config(path: Path | None) -> dict:
    if path is None or not path.is_file():
        return {}
    try:
        return tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        log.warning("Ignoring unreadable %s: %s", path, exc)
        return {}


def _toml_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def update_config(path: Path, **changes: object) -> None:
    """Merge `changes` into the flat config file (other keys are kept)."""
    data = {**read_config(path), **changes}
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# Chorus settings. Restart Chorus after editing.", ""]
    lines += [f"{key} = {_toml_value(value)}" for key, value in data.items() if not isinstance(value, (dict, list))]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _parse_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    return True if text in _TRUE else False if text in _FALSE else None


def _parse_port(value: object, source: str) -> int | None:
    try:
        port = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        port = 0
    if 1 <= port <= 65535 and not isinstance(value, bool):
        return port
    log.warning("Ignoring invalid port %r from %s", value, source)
    return None


def _layer_host(host: object, allow_remote: object) -> str | None:
    """One source's opinion on the bind address: an explicit host wins over allow_remote."""
    if host:
        return str(host)
    allowed = _parse_bool(allow_remote) if allow_remote is not None else None
    if allowed is None:
        return None
    return ANY_HOST if allowed else LOCAL_HOST


@dataclass(frozen=True)
class Network:
    host: str
    port: int
    port_explicit: bool  # False = the built-in default, which the tray may replace if another program owns it

    @property
    def remote(self) -> bool:
        return self.host not in (LOCAL_HOST, "localhost", "::1")


def resolve_network(
    *,
    default_port: int,
    cli_host: str | None = None,
    cli_port: int | None = None,
    cli_allow_remote: bool | None = None,
    env: Mapping[str, str] = os.environ,
    config: Mapping[str, object] | None = None,
) -> Network:
    config = config or {}
    layers = [
        ("command line", cli_host, cli_allow_remote, cli_port),
        ("CHORUS_* environment", env.get("CHORUS_HOST"), env.get("CHORUS_ALLOW_REMOTE"), env.get("CHORUS_PORT")),
        (CONFIG_FILE, config.get("host"), config.get("allow_remote"), config.get("port")),
    ]
    host = next((h for h in (_layer_host(*layer[1:3]) for layer in layers) if h), LOCAL_HOST)
    port, explicit = default_port, False
    for source, _host, _allow, raw in layers:
        if raw is not None and (parsed := _parse_port(raw, source)) is not None:
            port, explicit = parsed, True
            break
    return Network(host, port, explicit)
