# PyInstaller spec. Build from the repository root after `npm run build` in frontend/:
#   cd backend && uv sync --group desktop --group build
#   uv run python ../packaging/make_icons.py
#   uv run pyinstaller ../packaging/chorus.spec --noconfirm --distpath ../dist --workpath ../build
# Result: dist/Chorus.app (macOS), dist/Chorus/ (Windows), dist/chorus/ (Linux).
import re
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

root = Path(SPECPATH).resolve().parent
backend = root / "backend"
version = re.search(r'__version__ = "([^"]+)"', (backend / "app" / "__init__.py").read_text()).group(1)
assets = root / "packaging" / "assets"

linux = sys.platform.startswith("linux")
mac = sys.platform == "darwin"
name = "chorus" if linux else "Chorus"
icon = None if linux else str(assets / ("chorus.icns" if mac else "chorus.ico"))

datas = [
    (str(backend / "migrations"), "migrations"),
    (str(root / "frontend" / "dist"), "frontend-dist"),
]
datas += collect_data_files("wordfreq")

hiddenimports = (
    collect_submodules("app")
    + collect_submodules("uvicorn")
    + collect_submodules("alembic")
    + collect_submodules("sqlalchemy.dialects.sqlite")
    + collect_submodules("sqlalchemy.dialects.mysql")
    + ["pymysql"]
)
if not linux:  # the tray exists on Windows and macOS only
    hiddenimports += collect_submodules("pystray")

a = Analysis(
    [str(root / "packaging" / "entry.py")],
    pathex=[str(backend)],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "pytest"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name=name,
    console=linux,  # Linux is a command-line server binary; the desktop apps have no console window
    icon=icon,
)
coll = COLLECT(exe, a.binaries, a.datas, name=name)

if mac:
    app = BUNDLE(
        coll,
        name="Chorus.app",
        icon=icon,
        bundle_identifier="app.chorus",
        version=version,
        info_plist={
            "CFBundleName": "Chorus",
            "CFBundleDisplayName": "Chorus",
            "CFBundleShortVersionString": version,
            "LSUIElement": True,  # menu-bar app: no Dock icon
            "NSHighResolutionCapable": True,
        },
    )
