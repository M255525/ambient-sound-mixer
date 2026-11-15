# 產生 PWA 圖示（混音台三根推桿），python tools/make_icons.py
from PIL import Image, ImageDraw
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
def icon(size, pad=0.0):
    s = 4 * size
    im = Image.new('RGBA', (s, s), (27, 26, 24, 255))
    d = ImageDraw.Draw(im)
    k = s * (1 - 2 * pad) / 512; o = s * pad
    d.rounded_rectangle([o + 48*k, o + 48*k, o + 464*k, o + 464*k], radius=60*k, fill=(49, 47, 43, 255))
    for x, y, col in [(150, 290, (236, 226, 200)), (256, 170, (255, 180, 58)), (362, 330, (236, 226, 200))]:
        d.rounded_rectangle([o + (x - 9)*k, o + 100*k, o + (x + 9)*k, o + 412*k], radius=9*k, fill=(14, 13, 12, 255))
        d.rounded_rectangle([o + (x - 44)*k, o + (y - 24)*k, o + (x + 44)*k, o + (y + 24)*k], radius=8*k, fill=col)
        d.rectangle([o + (x - 36)*k, o + (y - 3)*k, o + (x + 36)*k, o + (y + 3)*k], fill=(60, 57, 52, 255))
    return im.resize((size, size), Image.LANCZOS)
icon(192).save(os.path.join(OUT, 'icon-192.png'))
icon(512).save(os.path.join(OUT, 'icon-512.png'))
icon(512, pad=0.1).save(os.path.join(OUT, 'icon-maskable-512.png'))
icon(180).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
print('ok')
