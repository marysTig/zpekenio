"""
Generate Android launcher icons from a source image.
Outputs: ic_launcher.png and ic_launcher_round.png in each mipmap-* folder.
"""
from PIL import Image
import os
import shutil

SRC = r"public\photo_5926972079150403967_y.jpg"
RES  = r"android\app\src\main\res"

SIZES = {
    "mipmap-mdpi":    48,
    "mipmap-hdpi":    72,
    "mipmap-xhdpi":   96,
    "mipmap-xxhdpi":  144,
    "mipmap-xxxhdpi": 192,
}

img = Image.open(SRC).convert("RGBA")

# Crop to square (centre-crop)
w, h = img.size
side = min(w, h)
left = (w - side) // 2
top  = (h - side) // 2
img  = img.crop((left, top, left + side, top + side))

def make_circle(image: Image.Image, size: int) -> Image.Image:
    """Return a circular-cropped icon (for round variants)."""
    img_r = image.resize((size, size), Image.LANCZOS)
    mask  = Image.new("L", (size, size), 0)
    from PIL import ImageDraw
    draw  = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size, size), fill=255)
    out   = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img_r, (0, 0), mask)
    return out

for folder, size in SIZES.items():
    target = os.path.join(RES, folder)
    os.makedirs(target, exist_ok=True)

    # Square icon
    square = img.resize((size, size), Image.LANCZOS)
    square.save(os.path.join(target, "ic_launcher.png"), "PNG")

    # Round icon
    circle = make_circle(img, size)
    circle.save(os.path.join(target, "ic_launcher_round.png"), "PNG")

    # Also write ic_launcher_foreground.png (for adaptive icons)
    square.save(os.path.join(target, "ic_launcher_foreground.png"), "PNG")

    print(f"  {folder}: {size}x{size}  OK")

print("\nAll icons generated successfully!")
