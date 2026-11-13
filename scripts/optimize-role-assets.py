"""Regenerate browser card images: Python 3 + Pillow (pip install Pillow).

Source PNGs remain as compatible fallbacks. Run from any working directory.
"""
from pathlib import Path

from PIL import Image

roles = Path(__file__).resolve().parents[1] / "apps/web/public/assets/roles"
source_bytes = 0
webp_bytes = 0
for source in sorted(roles.glob("*.png")):
    with Image.open(source) as image:
        for width in (320, 640):
            resized = image.copy()
            resized.thumbnail((width, width * 2), Image.Resampling.LANCZOS)
            destination = source.with_name(f"{source.stem}-{width}.webp")
            resized.save(destination, "WEBP", quality=84, method=6)
            webp_bytes += destination.stat().st_size
    source_bytes += source.stat().st_size
print(f"PNG fallbacks: {source_bytes:,} bytes; both WebP sizes: {webp_bytes:,} bytes")
