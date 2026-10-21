"""Recolor the Melodict/Nora bird logo to the Sage Green theme family.

Reads the user's parrot PNG (5 flat colour classes), remaps each class with
soft masks (preserving antialiased edges), and writes every logo asset the
app ships: UI webp/png copies, resources/ copy, and the build/ icon set.
"""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np, colorsys, collections, os

SRC = '/private/tmp/claude-501/-Users-mac-Develop-personal-Melodict-v4/030854b5-9223-4f06-80f3-d33b0a71296a/images/1.png'
ROOT = '/Users/mac/Develop/personal/Melodict.sage'

def hsl(h, s, l):
    r, g, b = colorsys.hls_to_rgb(h/360, l, s)
    return np.array([r*255, g*255, b*255])

im = Image.open(SRC).convert('RGB')
a = np.asarray(im).astype(np.float64)
H, W, _ = a.shape

# soft class weights (bg, body-green, face-yellow, dark, white)
srcs = np.array([[252,175,109],[118,178,74],[251,219,85],[53,39,34],[252,252,252]], float)
d2 = ((a[:, :, None, :] - srcs[None, None, :, :]) ** 2).sum(-1)
w = np.exp(-d2 / (2 * 20.0 ** 2))
w = w / w.sum(-1, keepdims=True)

# split yellow class into wing vs face: erode hard mask, label 2 components,
# BFS-assign soft antialias pixels to the nearest component
r8, g8, b8 = a[..., 0], a[..., 1], a[..., 2]
yellow_hard = (r8 > 220) & (g8 > 190) & (b8 < 140)
mask = Image.fromarray((yellow_hard * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(9))
em = np.asarray(mask) > 128

def flood(seed, val):
    img = mask.copy()
    ImageDraw.floodfill(img, seed, val, thresh=0)
    return np.asarray(img) == val

wing_c = flood((150, 1000), 100)
face_c = flood((800, 450), 200)
soft = w[:, :, 2] > 0.02
GRID = np.zeros((H, W), np.int8)
GRID[wing_c] = 1
GRID[face_c] = 2
q = collections.deque()
ys_, xs_ = np.where(GRID > 0)
for y, x in zip(ys_, xs_):
    q.append((int(y), int(x)))
while q:
    y, x = q.popleft()
    v = GRID[y, x]
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < H and 0 <= nx < W and GRID[ny, nx] == 0 and soft[ny, nx]:
            GRID[ny, nx] = v
            q.append((ny, nx))
wing_w = np.where(GRID == 1, w[:, :, 2], 0.0)
face_w = np.where(GRID == 2, w[:, :, 2], 0.0)

# --- Mint palette (the user's chosen default theme: sidebar mint #DDEEE6 family) ---
SAGE_BODY = hsl(151, 0.357, 0.50)  # #52AD81 = the song's Vibrant swatch
SAGE_BG = hsl(152, 0.333, 0.90)  # #DDEEE6 = sidebar / background-color-2 mint
SAGE_WING = hsl(152, 0.45, 0.82)  # #BCE6D2 light mint wing
SAGE_FACE = (245, 231, 200)  # #F5E7C8 warm cream face (kept warm on purpose)
SAGE_DARK = hsl(152, 0.15, 0.20)  # #2B3B34 deep green-grey eyes/mouth

def render_sage():
    tg = np.stack([SAGE_BG, SAGE_BODY, SAGE_FACE, SAGE_DARK, np.array([255, 255, 255.0])])
    out = np.einsum('hwk,kc->hwc', w, tg)
    tot = wing_w + face_w
    frac = np.divide(wing_w, tot, out=np.zeros_like(tot), where=tot > 0)
    out = out * (1 - frac[..., None]) + frac[..., None] * SAGE_WING[None, None, :]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

master = render_sage()  # 1254x1254, square, full-bleed

def rounded(img, radius_frac):
    im2 = img.convert('RGBA')
    s = im2.size[0]
    m = Image.new('L', (s, s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, s - 1, s - 1], radius=round(s * radius_frac), fill=255)
    im2.putalpha(m)
    return im2

os.makedirs(f'{ROOT}/tools', exist_ok=True)

# 1) UI assets: 400x400 with 6.25% corner radius (matches existing logo_light_mode)
ui = rounded(master.resize((400, 400), Image.LANCZOS), 0.0625)
ui.save(f'{ROOT}/src/renderer/src/assets/images/webp/logo_light_mode.webp', quality=90)
ui.save(f'{ROOT}/src/renderer/src/assets/images/logo_light_mode.png')
ui.save(f'{ROOT}/resources/logo_light_mode.png')

# 2) build/icon.png: 1024 content centred in 1124 canvas, ~4.2% radius, transparent corners
content = 1024
c = rounded(master.resize((content, content), Image.LANCZOS), 0.042)
canvas = Image.new('RGBA', (1124, 1124), (0, 0, 0, 0))
canvas.paste(c, (50, 40))
canvas.save(f'{ROOT}/build/icon.png')

# 3) build/icon.ico (256) and installer bmp (144, opaque white behind rounded corners)
ico_src = rounded(master.resize((256, 256), Image.LANCZOS), 0.042)
ico_src.save(f'{ROOT}/build/icon.ico', sizes=[(256, 256)])
bmp = Image.new('RGB', (256, 256), (255, 255, 255))
bmp.paste(ico_src, (0, 0), ico_src)
bmp.resize((144, 144), Image.LANCZOS).save(f'{ROOT}/build/installer_assets/icon.bmp')
master.save(f'{ROOT}/tools/sage_logo_master.png')
print('all sage logo assets written')
