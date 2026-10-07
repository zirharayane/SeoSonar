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

    # 2. Fallbacks
    icon192 = icon256.resize((192, 192), Image.Resampling.NEAREST)
    icon192.save("public/assets/icon-192.png", "PNG")
    print("Exported public/assets/icon-192.png")

    # Favicon.ico with 16, 32, 48
    icon16 = icon256.resize((16, 16), Image.Resampling.NEAREST)
    icon48 = icon256.resize((48, 48), Image.Resampling.NEAREST)
    icon256.save(
        "public/favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print("Exported public/favicon.ico")

    # apple-touch-icon.png (180x180, solid teal #008080 background, no transparency)
    apple_icon = Image.new("RGB", (180, 180), color=(0, 128, 128))
    # Paste centered 150x150 icon
    icon150 = icon256.resize((150, 150), Image.Resampling.NEAREST)
    apple_icon.paste(icon150, (15, 15), icon150)
    apple_icon.save("public/apple-touch-icon.png", "PNG")
    print("Exported public/apple-touch-icon.png")

    # 3. Create og-image.png (1200x630, PNG, solid teal background, win98 window, icon, title, tagline)
    og_img = Image.new("RGB", (1200, 630), color=(0, 128, 128))
    draw = ImageDraw.Draw(og_img)

    # Draw classic Win98 dialog window in center
    win_x1, win_y1, win_x2, win_y2 = 120, 70, 1080, 560
    # Outer 3D bevel (Win98 style)
    # Window background: #c0c0c0
    draw.rectangle([win_x1, win_y1, win_x2, win_y2], fill=(192, 192, 192), outline=(0, 0, 0))
    # Bevel highlights
    draw.line([win_x1, win_y1, win_x2 - 1, win_y1], fill=(255, 255, 255), width=3)
    draw.line([win_x1, win_y1, win_x1, win_y2 - 1], fill=(255, 255, 255), width=3)
    draw.line([win_x2 - 1, win_y1 + 1, win_x2 - 1, win_y2 - 1], fill=(128, 128, 128), width=3)
    draw.line([win_x1 + 1, win_y2 - 1, win_x2 - 1, win_y2 - 1], fill=(128, 128, 128), width=3)

    # Title bar gradient / solid navy #000080
    tbar_h = 50
    draw.rectangle([win_x1 + 6, win_y1 + 6, win_x2 - 6, win_y1 + 6 + tbar_h], fill=(0, 0, 128))

    # Close button [X]
    btn_w = 40
    btn_x = win_x2 - 12 - btn_w
    btn_y = win_y1 + 11
    draw.rectangle([btn_x, btn_y, btn_x + btn_w, btn_y + 38], fill=(192, 192, 192), outline=(0, 0, 0))
    draw.line([btn_x + 1, btn_y + 1, btn_x + btn_w - 1, btn_y + 1], fill=(255, 255, 255), width=2)
    draw.line([btn_x + 1, btn_y + 1, btn_x + 1, btn_y + 37], fill=(255, 255, 255), width=2)
    draw.line([btn_x + btn_w, btn_y + 1, btn_x + btn_w, btn_y + 38], fill=(0, 0, 0), width=2)
    draw.line([btn_x + 1, btn_y + 38, btn_x + btn_w, btn_y + 38], fill=(0, 0, 0), width=2)

    # Load font or fall back
    font_large = None
    font_sub = None
    font_title = None
    font_badge = None
    font_paths = [
        "C:/Windows/Fonts/micross.ttf",
        "C:/Windows/Fonts/tahoma.ttf",
        "C:/Windows/Fonts/arial.ttf"
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                font_title = ImageFont.truetype(fp, 26)
                font_large = ImageFont.truetype(fp, 56)
                font_sub = ImageFont.truetype(fp, 28)
                font_badge = ImageFont.truetype(fp, 20)
                break
            except Exception:
                pass

    if not font_large:
        font_large = ImageFont.load_default()
        font_sub = ImageFont.load_default()
        font_title = ImageFont.load_default()
        font_badge = ImageFont.load_default()

    # Draw Title Bar text
    draw.text((win_x1 + 18, win_y1 + 16), "SeoSonar - Global Website Auditor", fill=(255, 255, 255), font=font_title)
    draw.text((btn_x + 13, btn_y + 6), "r", fill=(0, 0, 0), font=font_title) # marlett-style or 'X'
    draw.text((btn_x + 12, btn_y + 8), "X", fill=(0, 0, 0), font=font_title)

    # Paste Icon inside window
    icon_content = icon256.resize((220, 220), Image.Resampling.NEAREST)
    og_img.paste(icon_content, (win_x1 + 45, win_y1 + 95), icon_content)

    # Window content text
    text_x = win_x1 + 300
    draw.text((text_x, win_y1 + 105), "SeoSonar", fill=(0, 0, 128), font=font_large)
    draw.text((text_x, win_y1 + 185), "Free retro SEO checker, pinged from around the world", fill=(30, 30, 30), font=font_sub)

    # Retro status boxes / badges inside window
    features = [
        "System Rating (0-100)",
        "Mobile & Desktop PageSpeed",
        "Globalping 5-Country Probes",
        "On-Page SEO & Crawl Audits",
        "Security Headers & SSRF Guard",
        "100% Client Privacy & Local History"
    ]
    badge_x = text_x
    badge_y = win_y1 + 250
    for i, feat in enumerate(features):
        col = i % 2
        row = i // 2
        bx = badge_x + col * 340
        by = badge_y + row * 52
        draw.rectangle([bx, by, bx + 320, by + 40], fill=(255, 255, 255), outline=(128, 128, 128))
        draw.line([bx, by, bx + 320, by], fill=(128, 128, 128), width=1)
        draw.line([bx, by, bx, by + 40], fill=(128, 128, 128), width=1)
        draw.line([bx + 319, by, bx + 319, by + 40], fill=(255, 255, 255), width=1)
        draw.line([bx, by + 39, bx + 320, by + 39], fill=(255, 255, 255), width=1)
        draw.text((bx + 12, by + 9), f"[✓] {feat}", fill=(0, 0, 0), font=font_badge)

    # Retro Taskbar / OK Button
    ok_x = win_x2 - 160
    ok_y = win_y2 - 65
    draw.rectangle([ok_x, ok_y, ok_x + 130, ok_y + 40], fill=(192, 192, 192), outline=(0, 0, 0))
    draw.line([ok_x + 1, ok_y + 1, ok_x + 129, ok_y + 1], fill=(255, 255, 255), width=2)
    draw.line([ok_x + 1, ok_y + 1, ok_x + 1, ok_y + 39], fill=(255, 255, 255), width=2)
    draw.line([ok_x + 129, ok_y + 1, ok_x + 129, ok_y + 39], fill=(128, 128, 128), width=2)
    draw.line([ok_x + 1, ok_y + 39, ok_x + 129, ok_y + 39], fill=(128, 128, 128), width=2)
    draw.text((ok_x + 32, ok_y + 9), "Scan Now", fill=(0, 0, 0), font=font_badge)

    # Credit in window bottom left
    draw.text((win_x1 + 35, win_y2 - 50), "Made by Rayane Zirha | RZ(TM) Creative", fill=(100, 100, 100), font=font_badge)

    og_img.save("public/og-image.png", "PNG")
    print("Exported public/og-image.png (1200x630)")

if __name__ == "__main__":
    main()
