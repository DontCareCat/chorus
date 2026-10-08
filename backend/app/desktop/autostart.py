"""Start Chorus when the user logs in: a registry Run value on Windows, a LaunchAgent on macOS."""
import subprocess
import sys
from pathlib import Path
from xml.sax.saxutils import escape

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_NAME = "Chorus"
AGENT_LABEL = "app.chorus.tray"


def launch_command() -> list[str]:
    """How to start the tray: the packaged executable, or this interpreter when running from source."""
    if getattr(sys, "frozen", False):
        return [sys.executable]
    return [sys.executable, "-m", "app.launcher", "tray"]


def windows_command_line(command: list[str]) -> str:
    return subprocess.list2cmdline(command)


def launch_agent_plist(command: list[str]) -> str:
    args = "\n".join(f"        <string>{escape(part)}</string>" for part in command)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
{args}
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"""


def agent_path(home: Path | None = None) -> Path:
    return (home or Path.home()) / "Library" / "LaunchAgents" / f"{AGENT_LABEL}.plist"


def is_supported() -> bool:
    return sys.platform in ("win32", "darwin")


def is_enabled(home: Path | None = None) -> bool:
    if sys.platform == "darwin":
        return agent_path(home).is_file()
    if sys.platform == "win32":
        import winreg

        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
                winreg.QueryValueEx(key, RUN_NAME)
            return True
        except FileNotFoundError:
            return False
    return False


def set_enabled(enabled: bool, home: Path | None = None) -> None:
    if sys.platform == "darwin":
        path = agent_path(home)
        if enabled:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(launch_agent_plist(launch_command()), encoding="utf-8")
        else:
            path.unlink(missing_ok=True)
    elif sys.platform == "win32":
        import winreg

        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            if enabled:
                winreg.SetValueEx(key, RUN_NAME, 0, winreg.REG_SZ, windows_command_line(launch_command()))
            else:
                try:
                    winreg.DeleteValue(key, RUN_NAME)
                except FileNotFoundError:
                    pass
