from pathlib import Path
import io
import cairosvg
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "assets" / "portal"

CARDS = {
    "wetter-full": ("Wetter", "Fantasy-Wetter und Wetterverwaltung"),
    "tagebuch-full": ("Tagebuch", "Persönliche Chroniken deiner Charaktere"),
    "aufgaben-full": ("Aufgaben", "Admin-Aufgaben erstellen und verwalten"),
    "projekte-full": ("Projekte", "Projekte planen und im Blick behalten"),
    "admin-tagebuch-full": ("Tagebuch-Verwaltung", "Spieler-Tagebücher verwalten"),
    "blacklist-full": ("Blacklist", "Gesperrte Spieler und Steam-IDs"),
    "aktivitaeten-full": ("Aktivitäten", "Administrative Änderungen und Aktionen"),
}

def font(size, bold=False):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def tint(img):
    img = img.convert("RGBA")
    # Turn the parchment artwork into the same dark violet atmosphere as the
    # existing Chroniken portal cards while keeping the original line drawing.
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255.0
            # dark violet base with lighter lavender highlights
            nr = int(25 + lum * 92)
            ng = int(10 + lum * 58)
            nb = int(38 + lum * 105)
            px[x, y] = (nr, ng, nb, a)
    return img

def add_card_text(img, title, subtitle):
    draw = ImageDraw.Draw(img, "RGBA")
    # soft bottom veil so the typography reads like the reference cards
    veil = Image.new("RGBA", img.size, (0, 0, 0, 0))
    vd = ImageDraw.Draw(veil, "RGBA")
    for y in range(345, 520):
        alpha = int(185 * ((y - 345) / 175))
        vd.rectangle((0, y, 900, y + 2), fill=(10, 4, 18, alpha))
    veil = veil.filter(ImageFilter.GaussianBlur(5))
    img.alpha_composite(veil)

    title_font = font(42, True)
    sub_font = font(22, False)
    draw.text((38, 382), title, font=title_font, fill=(225, 190, 245, 255),
              stroke_width=2, stroke_fill=(38, 12, 52, 220))
    draw.text((40, 438), subtitle, font=sub_font, fill=(210, 181, 226, 245),
              stroke_width=1, stroke_fill=(30, 10, 42, 180))

    # portal-card border matching the existing reference look
    draw.rounded_rectangle((10, 10, 890, 510), radius=28,
                           outline=(119, 67, 153, 255), width=4)
    draw.rounded_rectangle((17, 17, 883, 503), radius=23,
                           outline=(66, 34, 86, 220), width=2)

for stem, (title, subtitle) in CARDS.items():
    src = PORTAL / f"{stem}.svg"
    dst = PORTAL / f"{stem}.png"
    if not src.exists():
        print(f"Missing {src}")
        continue

    png_bytes = cairosvg.svg2png(
        url=str(src),
        output_width=900,
        output_height=520,
    )
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    img = tint(img)
    add_card_text(img, title, subtitle)
    img.save(dst, "PNG", optimize=True)
    print(f"Generated {dst}")
