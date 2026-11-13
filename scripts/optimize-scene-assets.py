"""Regenerate browser scene backdrops from the source artwork.

Source artwork lives in incoming-assets/ and is never referenced by production
code. This writes English-named WebP files into apps/web/public/assets/scenes/
at two widths; the UI switches them by game phase.

Requires Python 3 + Pillow (pip install Pillow). Run from any directory.
"""
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parents[1]
source_dir = root / "incoming-assets"
output_dir = root / "apps/web/public/assets/scenes"

scenes = {
    "等待大厅，宁静的期待.png": "waiting-hall",
    "深夜行动，屏息的寂静.png": "deep-night",
    "破晓村庄，真相将明.png": "dawn-village",
    "白天广场，公开裁决.png": "day-square",
    "好人胜利，黎明解脱.png": "good-victory",
    "狼人胜利，永夜降临.png": "wolf-victory",
    "毒药.png": "poison",
    "解药.png": "antidote",
}

output_dir.mkdir(parents=True, exist_ok=True)
source_bytes = 0
webp_bytes = 0
for filename, slug in scenes.items():
    if Path(filename).name != filename or filename not in scenes:
        raise ValueError(f"Unexpected scene source name: {filename}")
    source = (source_dir / filename).resolve()
    if source.parent != source_dir.resolve():
        raise ValueError(f"Scene source escapes the asset directory: {filename}")
    with Image.open(source) as image:
        rgb = image.convert("RGB")
        for width in (640, 1280):
            resized = rgb.copy()
            resized.thumbnail((width, width * 2), Image.Resampling.LANCZOS)
            destination = output_dir / f"{slug}-{width}.webp"
            resized.save(destination, "WEBP", quality=80, method=6)
            webp_bytes += destination.stat().st_size
    source_bytes += source.stat().st_size

print(f"Scene PNG sources: {source_bytes:,} bytes; WebP outputs: {webp_bytes:,} bytes")
