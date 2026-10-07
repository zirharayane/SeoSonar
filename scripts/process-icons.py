"""
Asset processing script for SeoSonar.
Extracts icon from assets-src/icon_256.jpg:
- Flood-fills corner flat-gray background to transparency
- Snaps using nearest-neighbor scaling
- Cleans fringe pixels
- Exports icon-256.webp, icon-64.webp, icon-32.webp
- Exports favicon.ico (16/32/48)
- Exports icon-192.png and apple-touch-icon.png (180x180 solid background)
- Creates og-image.png (1200x630) with teal background, Win98 window, icon, and tagline
"""

import os
from collections import deque
from PIL import Image, ImageDraw, ImageFont

def process_base_icon(src_path):
    img = Image.open(src_path).convert('RGBA')
    # Resample to clean 256x256 pixel grid using nearest neighbor
    img256 = img.resize((256, 256), Image.Resampling.NEAREST)
    w, h = img256.size
    pixels = img256.load()

    # Sample corners to determine background gray
    corners = [pixels[0, 0], pixels[w - 1, 0], pixels[0, h - 1], pixels[w - 1, h - 1]]
    bg_r = sum(c[0] for c in corners) // 4
    bg_g = sum(c[1] for c in corners) // 4
    bg_b = sum(c[2] for c in corners) // 4
    tolerance = 28

    visited = bytearray(w * h)
    queue = deque([(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])
    for x, y in queue:
        visited[y * w + x] = 1

    def is_bg(r, g, b):
        return (
            abs(r - bg_r) < tolerance and
            abs(g - bg_g) < tolerance and
            abs(b - bg_b) < tolerance and
            abs(r - g) < 16 and
            abs(g - b) < 16
        )

    # Flood fill outer background to transparent
    while queue:
        cx, cy = queue.popleft()
        pixels[cx, cy] = (0, 0, 0, 0)
        for nx, ny in [(cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)]:
            if 0 <= nx < w and 0 <= ny < h and not visited[ny * w + nx]:
                visited[ny * w + nx] = 1
                nr, ng, nb, _ = pixels[nx, ny]
                if is_bg(nr, ng, nb):
                    queue.append((nx, ny))

    # Clean up fringe pixels touching transparency that are gray residue
    for y in range(h):
        for x in range(w):
            if pixels[x, y][3] > 0:
                r, g, b, _ = pixels[x, y]
                if abs(r - g) < 10 and abs(g - b) < 10 and 150 < r < 215:
                    has_trans = any(
                        0 <= nx < w and 0 <= ny < h and pixels[nx, ny][3] == 0
                        for nx, ny in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
                    )
                    if has_trans:
                        pixels[x, y] = (0, 0, 0, 0)

    return img256

def main():
    src = "assets-src/icon_256.jpg"
    if not os.path.exists(src):
        if os.path.exists("icon 256.jpg"):
            src = "icon 256.jpg"
        else:
            raise FileNotFoundError("icon_256.jpg not found in assets-src or root")

    os.makedirs("public/assets", exist_ok=True)

    print(f"Processing base icon from {src}...")
    icon256 = process_base_icon(src)

    # 1. Export WebP transparent icons (lossless, nearest neighbor for sharpness)
    icon256.save("public/assets/icon-256.webp", "WEBP", lossless=True)
    print("Exported public/assets/icon-256.webp")

    icon64 = icon256.resize((64, 64), Image.Resampling.NEAREST)
    icon64.save("public/assets/icon-64.webp", "WEBP", lossless=True)
    print("Exported public/assets/icon-64.webp")

    icon32 = icon256.resize((32, 32), Image.Resampling.NEAREST)
    icon32.save("public/assets/icon-32.webp", "WEBP", lossless=True)
    print("Exported public/assets/icon-32.webp")

    # Favicon.ico with 16, 32, 48
    icon16 = icon256.resize((16, 16), Image.Resampling.NEAREST)
    icon48 = icon256.resize((48, 48), Image.Resampling.NEAREST)
    icon256.save(
        "public/favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print("Exported public/favicon.ico")

if __name__ == "__main__":
    main()
