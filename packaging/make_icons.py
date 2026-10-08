"""Write the app icons PyInstaller needs (chorus.png/.ico/.icns) into packaging/assets/ from the Pillow drawing."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.desktop.icons import draw_icon  # noqa: E402

out = Path(__file__).resolve().parent / "assets"
out.mkdir(exist_ok=True)
image = draw_icon(1024)
image.resize((512, 512)).save(out / "chorus.png")
image.save(out / "chorus.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
image.save(out / "chorus.icns")
print("icons written to", out)
