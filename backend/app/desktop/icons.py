"""The Chorus mark (frontend/public/favicon.svg) drawn with Pillow, so the tray needs no image files."""
from PIL import Image, ImageDraw

INK, PAPER, SIGNAL = "#1b1745", "#e9e6f5", "#ff5a1f"


def draw_icon(size: int = 256) -> Image.Image:
    scale = 4  # draw large, shrink for smooth edges
    s = size * scale
    u = s / 64  # the SVG's 64x64 grid
    image = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(image)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=12 * u, fill=INK)
    d.line((10 * u, 38 * u, 54 * u, 38 * u), fill=PAPER, width=round(5 * u))
    for cx in (20, 44):
        r = 5.5 * u
        d.ellipse((cx * u - r, 38 * u - r, cx * u + r, 38 * u + r), fill=INK, outline=PAPER, width=round(3.5 * u))
    d.line((32 * u, 14 * u, 32 * u, 48 * u), fill=SIGNAL, width=round(5 * u))
    d.polygon([(25 * u, 14 * u), (39 * u, 14 * u), (32 * u, 22 * u)], fill=SIGNAL)
    return image.resize((size, size), Image.LANCZOS)
