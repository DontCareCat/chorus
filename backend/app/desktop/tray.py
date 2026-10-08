"""The desktop app: the server runs in a background thread, the tray icon owns the main thread (macOS requires it)."""
import logging
import logging.handlers
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from collections.abc import Callable
from pathlib import Path

from app import __version__
from app.desktop import autostart, userconfig

log = logging.getLogger("chorus.tray")


def configure_file_logging(path: Path) -> None:
    handler = logging.handlers.RotatingFileHandler(path, maxBytes=1_000_000, backupCount=2, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler, logging.StreamHandler()], force=True)


def show_error(message: str) -> None:
    """There may be no console, so a startup failure needs a visible dialog."""
    log.error(message)
    try:
        if sys.platform == "win32":
            import ctypes

            ctypes.windll.user32.MessageBoxW(0, message, "Chorus", 0x10)
        elif sys.platform == "darwin":
            text = message.replace("\\", "\\\\").replace('"', '\\"')
            subprocess.run(["osascript", "-e", f'display alert "Chorus" message "{text}" as critical'], check=False)
        else:
            print(message, file=sys.stderr)
    except Exception:  # noqa: BLE001
        log.exception("Could not show the error dialog")


def open_path(path: Path) -> None:
    if sys.platform == "win32":
        os.startfile(path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.run(["open", str(path)], check=False)
    else:
        subprocess.run(["xdg-open", str(path)], check=False)


def lan_address() -> str | None:
    """This computer's address on the local network (a UDP 'connect' sends nothing)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("10.255.255.255", 1))
            return sock.getsockname()[0]
    except OSError:
        return None


class ServerThread:
    """uvicorn in a thread that can be stopped and started again (the bind address changes with the setting)."""

    def __init__(self, host: str, port: int) -> None:
        import uvicorn

        from app.main import app

        self.host, self.port = host, port
        self.server = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_config=None))
        self.thread = threading.Thread(target=self._run, name="chorus-server", daemon=True)
        self.failed = False

    def _run(self) -> None:
        try:
            self.server.run()
        except BaseException:  # uvicorn exits via SystemExit when it cannot bind
            self.failed = True
            log.exception("The server stopped unexpectedly")

    def start(self, timeout: float = 30.0) -> bool:
        self.thread.start()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.server.started:
                return True
            if not self.thread.is_alive():
                return False
            time.sleep(0.1)
        return False

    def stop(self) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=10)


def run(net: userconfig.Network, data_dir: Path, resolve: Callable[[], userconfig.Network]) -> int:
    import pystray

    from app.desktop.icons import draw_icon

    config_path = data_dir / userconfig.CONFIG_FILE
    state = {"net": net, "server": None}

    def local_url() -> str:
        return f"http://localhost:{state['net'].port}"

    def status_text(_item=None) -> str:
        current = state["net"]
        if current.remote and (lan := lan_address()):
            return f"Running at http://{lan}:{current.port}"
        return f"Running at {local_url()}"

    def notify(message: str) -> None:
        try:
            icon.notify(message, "Chorus")
        except Exception:  # noqa: BLE001 - not every platform supports notifications
            log.info(message)

    def start_server() -> bool:
        current = state["net"]
        server = ServerThread(current.host, current.port)
        state["server"] = server
        return server.start()

    def open_ui(_icon=None, _item=None) -> None:
        webbrowser.open(local_url())

    def toggle_remote(_icon, _item) -> None:
        wanted = not state["net"].remote
        userconfig.update_config(config_path, allow_remote=wanted, host="")
        state["server"].stop()
        state["net"] = resolve()
        if state["net"].remote != wanted:
            notify("A command-line option or environment variable overrides this setting.")
        if not start_server():
            show_error("Chorus could not restart its server. See chorus.log in the data folder.")
            icon.stop()
            return
        if state["net"].remote:
            notify("Other devices on your network can now use Chorus. There is no login: use only trusted networks.")
        icon.update_menu()

    def toggle_autostart(_icon, _item) -> None:
        try:
            autostart.set_enabled(not autostart.is_enabled())
        except OSError as exc:
            notify(f"Could not change start at login: {exc}")

    def quit_app(_icon, _item) -> None:
        if state["server"]:
            state["server"].stop()
        icon.stop()

    items = [
        pystray.MenuItem("Open Chorus", open_ui, default=True),
        pystray.MenuItem(status_text, None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Allow connections from other devices", toggle_remote,
                         checked=lambda _item: state["net"].remote),
        pystray.MenuItem("Open config file", lambda *_: (
            None if config_path.exists() else userconfig.update_config(config_path, port=state["net"].port)
        ) or open_path(config_path)),
        pystray.MenuItem("Open data folder", lambda *_: open_path(data_dir)),
    ]
    if autostart.is_supported():
        items.append(pystray.MenuItem("Start at login", toggle_autostart, checked=lambda _item: autostart.is_enabled()))
    items += [pystray.Menu.SEPARATOR, pystray.MenuItem(f"Quit Chorus {__version__}", quit_app)]

    def setup(_icon) -> None:
        if start_server():
            _icon.visible = True
            open_ui()
        else:
            show_error("Chorus could not start its server. See chorus.log in the data folder.")
            _icon.stop()

    icon = pystray.Icon("chorus", draw_icon(64), "Chorus", pystray.Menu(*items))
    icon.run(setup)
    return 0
