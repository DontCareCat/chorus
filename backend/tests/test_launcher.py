import json
import plistlib
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect

import app as app_package
from app import launcher
from app.db import migrate
from app.desktop import autostart, userconfig


# ---------- network configuration: command line > environment > config.toml > default ----------
def net(**kw):
    kw.setdefault("env", {})
    return userconfig.resolve_network(default_port=8765, **kw)


def test_defaults_are_local_only():
    n = net()
    assert (n.host, n.port, n.port_explicit, n.remote) == ("127.0.0.1", 8765, False, False)


def test_allow_remote_binds_all_interfaces():
    assert net(config={"allow_remote": True}).host == "0.0.0.0"
    assert net(config={"allow_remote": True}).remote
    assert net(env={"CHORUS_ALLOW_REMOTE": "yes"}).host == "0.0.0.0"


def test_precedence_cli_over_env_over_file():
    config = {"port": 9001, "allow_remote": True}
    env = {"CHORUS_PORT": "9002", "CHORUS_ALLOW_REMOTE": "false"}
    assert net(config=config).port == 9001
    assert net(config=config, env=env).port == 9002
    assert net(config=config, env=env, cli_port=9003).port == 9003
    assert net(config=config).host == "0.0.0.0"
    assert net(config=config, env=env).host == "127.0.0.1"  # env switches remote access off again
    assert net(config=config, env=env, cli_allow_remote=True).host == "0.0.0.0"
    assert net(config=config, cli_host="192.168.1.5").host == "192.168.1.5"  # an explicit host beats allow_remote


@pytest.mark.parametrize("bad", [0, 70000, "abc", -5, True, 1.5e9])
def test_invalid_port_falls_back_to_the_next_source(bad):
    n = net(config={"port": bad})
    assert (n.port, n.port_explicit) == (8765, False)
    assert net(config={"port": 9001}, env={"CHORUS_PORT": str(bad)}).port == 9001


def test_config_file_roundtrip_keeps_other_keys(tmp_path):
    path = tmp_path / "sub" / "config.toml"
    userconfig.update_config(path, port=9100)
    userconfig.update_config(path, allow_remote=True, note='a "quoted" \\ value')
    assert userconfig.read_config(path) == {"port": 9100, "allow_remote": True, "note": 'a "quoted" \\ value'}
    assert userconfig.resolve_network(default_port=1, env={}, config=userconfig.read_config(path)).port == 9100


def test_unreadable_config_is_ignored(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text("this is = = not toml", encoding="utf-8")
    assert userconfig.read_config(path) == {}
    assert userconfig.read_config(tmp_path / "missing.toml") == {}
    assert userconfig.read_config(None) == {}


# ---------- data directory ----------
def test_default_data_dir_is_a_per_user_folder(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))
    path = userconfig.default_data_dir()
    assert tmp_path in path.parents
    assert path.name in ("Chorus", "chorus")


def test_data_dir_sets_database_and_media_paths(tmp_path):
    env: dict[str, str] = {}
    data_dir = launcher.prepare_environment(str(tmp_path / "data"), tray=False, env=env)
    assert data_dir == (tmp_path / "data").resolve()
    assert env["DATABASE_URL"] == f"sqlite:///{(data_dir / 'app.db').as_posix()}"
    assert env["MEDIA_DIR"] == str(data_dir / "media")
    assert (data_dir / "media").is_dir()


def test_explicit_settings_win_over_the_data_dir(tmp_path):
    env = {"DATABASE_URL": "mysql+pymysql://u:p@db/chorus", "MEDIA_DIR": "/srv/media"}
    launcher.prepare_environment(str(tmp_path), tray=False, env=env)
    assert env == {"DATABASE_URL": "mysql+pymysql://u:p@db/chorus", "MEDIA_DIR": "/srv/media"}


def test_data_dir_from_environment_and_no_data_dir_for_plain_serve(tmp_path):
    env = {"CHORUS_DATA_DIR": str(tmp_path)}
    assert launcher.prepare_environment(None, tray=False, env=env) == tmp_path.resolve()
    plain: dict[str, str] = {}
    assert launcher.prepare_environment(None, tray=False, env=plain) is None
    assert plain == {}  # from-source behaviour (working-directory defaults) is unchanged


def test_tray_uses_the_per_user_folder_by_default(tmp_path, monkeypatch):
    monkeypatch.setattr(userconfig, "default_data_dir", lambda: tmp_path / "Chorus")
    env: dict[str, str] = {}
    assert launcher.prepare_environment(None, tray=True, env=env) == tmp_path / "Chorus"
    assert env["DATABASE_URL"].endswith("/Chorus/app.db")


# ---------- frontend discovery ----------
def test_find_frontend_prefers_the_explicit_folder(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    for d in (a, b):
        d.mkdir()
        (d / "index.html").write_text("<html></html>")
    assert launcher.find_frontend(str(a), {"FRONTEND_DIST": str(b)}) == str(a.resolve())
    assert launcher.find_frontend(None, {"FRONTEND_DIST": str(b)}) == str(b.resolve())
    assert launcher.find_frontend(str(tmp_path / "empty"), {"FRONTEND_DIST": str(b)}) == str(b.resolve())


# ---------- ports ----------
def test_port_probes():
    import socket

    host = "127.0.0.1"
    port = launcher.free_port(host)
    assert launcher.port_is_free(host, port)
    with socket.socket() as busy:
        busy.bind((host, port))
        busy.listen()
        assert not launcher.port_is_free(host, port)
        assert not launcher.chorus_running(port, timeout=0.3)  # something listens, but it is not Chorus


def test_chorus_running_recognises_the_health_endpoint(monkeypatch):
    import io

    monkeypatch.setattr(launcher.urllib.request, "urlopen",
                        lambda url, timeout: io.BytesIO(json.dumps({"status": "ok", "app": "chorus"}).encode()))
    assert launcher.chorus_running(1234)
    monkeypatch.setattr(launcher.urllib.request, "urlopen",
                        lambda url, timeout: io.BytesIO(json.dumps({"status": "ok"}).encode()))
    assert not launcher.chorus_running(1234)


# ---------- migrations ----------
def test_upgrade_to_head_creates_the_schema_and_is_idempotent(tmp_path, monkeypatch):
    db = tmp_path / "x.db"
    from app.core.config import settings

    monkeypatch.setattr(settings, "database_url", f"sqlite:///{db.as_posix()}")
    migrate.upgrade_to_head()
    migrate.upgrade_to_head()
    tables = set(inspect(create_engine(f"sqlite:///{db.as_posix()}")).get_table_names())
    assert {"songs", "lyrics", "questions", "games", "alembic_version"} <= tables


def test_upgrade_to_head_waits_for_a_database_that_is_not_ready(monkeypatch):
    from sqlalchemy.exc import OperationalError

    calls, sleeps = [], []

    def flaky(config, revision):
        calls.append(revision)
        if len(calls) < 3:
            raise OperationalError("connect", {}, Exception("refused"))

    monkeypatch.setattr(migrate.command, "upgrade", flaky)
    migrate.upgrade_to_head(retries=5, delay=2, sleep=sleeps.append)
    assert len(calls) == 3 and sleeps == [2, 2]

    monkeypatch.setattr(migrate.command, "upgrade", lambda c, r: (_ for _ in ()).throw(
        OperationalError("connect", {}, Exception("down"))))
    with pytest.raises(OperationalError):
        migrate.upgrade_to_head(retries=2, delay=0, sleep=lambda s: None)


# ---------- start at login ----------
def test_launch_agent_plist_is_valid_and_escapes_paths():
    command = ["/Applications/Chorus & Co/Chorus.app/Contents/MacOS/Chorus"]
    parsed = plistlib.loads(autostart.launch_agent_plist(command).encode())
    assert parsed["Label"] == autostart.AGENT_LABEL
    assert parsed["ProgramArguments"] == command
    assert parsed["RunAtLoad"] is True


def test_windows_command_line_quotes_spaces():
    assert autostart.windows_command_line([r"C:\Program Files\Chorus\Chorus.exe"]) == r'"C:\Program Files\Chorus\Chorus.exe"'


@pytest.mark.skipif(sys.platform != "darwin", reason="LaunchAgents are macOS only")
def test_launch_agent_is_written_and_removed(tmp_path):
    assert not autostart.is_enabled(tmp_path)
    autostart.set_enabled(True, tmp_path)
    assert autostart.is_enabled(tmp_path)
    assert plistlib.loads(autostart.agent_path(tmp_path).read_bytes())["RunAtLoad"] is True
    autostart.set_enabled(False, tmp_path)
    assert not autostart.is_enabled(tmp_path)
    autostart.set_enabled(False, tmp_path)  # removing twice is fine


def test_unfrozen_launch_command_runs_the_tray_module():
    assert autostart.launch_command()[-3:] == ["-m", "app.launcher", "tray"]


# ---------- versions ----------
def test_version_matches_pyproject():
    text = (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text(encoding="utf-8")
    assert f'version = "{app_package.__version__}"' in text


def test_cli_without_arguments_prints_help_when_not_packaged(capsys):
    assert launcher.main([]) == 2
    assert "serve" in capsys.readouterr().out
