"""The Chorus mark (frontend/public/favicon.svg: three bars, as in the menu's wordmark) drawn with Pillow, so the tray needs no image files."""
from PIL import Image, ImageDraw

INK, BARS = "#25231e", "#ece64a"
# (left, top) of each bar on the SVG's 64x64 grid; width 8, bottom at 48
BAR_SPECS = ((14, 30), (28, 15), (42, 24))


def draw_icon(size: int = 256) -> Image.Image:
    scale = 4  # draw large, shrink for smooth edges
    s = size * scale
    u = s / 64
    image = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(image)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=14 * u, fill=INK)
    for x, top in BAR_SPECS:
        d.rounded_rectangle((x * u, top * u, (x + 8) * u, 48 * u), radius=4 * u, fill=BARS)
    return image.resize((size, size), Image.LANCZOS)
