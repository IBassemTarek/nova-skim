"""Generates Playables store thumbnails for Nova Skim: a code-drawn gameplay scene in the game's neon look.
No logo and no branding text: only gameplay elements (ship, planets, mine, orb, score), per the Playables design rules.
Run: python3 store/make_art.py
"""
import math
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT = '/System/Library/Fonts/Supplemental/Trebuchet MS Bold.ttf'
FONT_I = '/System/Library/Fonts/Supplemental/Trebuchet MS Bold Italic.ttf'
SS = 2

CYAN, MAGENTA, ORANGE, YELLOW, RED, VIOLET = (34, 230, 255), (255, 43, 214), (255, 154, 60), (255, 194, 60), (255, 51, 85), (122, 60, 255)
RIM = {'normal': (CYAN, MAGENTA), 'fast': ((184, 247, 255), (75, 123, 255)), 'crumble': (YELLOW, (255, 60, 142))}


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(w, h):
    stops = [(0.0, (6, 3, 38)), (0.55, (21, 10, 72)), (1.0, (54, 10, 90))]
    img = Image.new('RGB', (w, h))
    px = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(h - 1, 1)
        for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
            if t0 <= t <= t1:
                px.line([(0, y), (w, y)], fill=lerp(c0, c1, (t - t0) / (t1 - t0)))
    return img.convert('RGBA')


def layer(size):
    return Image.new('RGBA', size, (0, 0, 0, 0))


def glow(canvas, draw_fn, blur, boost=1):
    l = layer(canvas.size)
    draw_fn(ImageDraw.Draw(l))
    g = l.filter(ImageFilter.GaussianBlur(blur))
    for _ in range(boost):
        canvas.alpha_composite(g)
    return l


def stars(canvas, seed, n):
    rnd = random.Random(seed)
    d = ImageDraw.Draw(canvas)
    w, h = canvas.size
    for _ in range(n):
        x, y, s = rnd.random() * w, rnd.random() * h, rnd.choice([1, 1, 2, 3]) * SS
        a = rnd.randint(70, 200)
        d.rectangle([x, y, x + s, y + s], fill=(255, 255, 255, a))


def synth_floor(canvas, horizon, sun_r):
    w, h = canvas.size
    cx = w / 2
    sun = layer(canvas.size)
    sd = ImageDraw.Draw(sun)
    for i in range(9):
        r = sun_r - i * sun_r * 0.02
        sd.ellipse([cx - r, horizon - r * 0.8 - r * 0.2, cx + r, horizon + r * 0.2 - r * 0.2 + r * 0.8], fill=lerp(ORANGE, MAGENTA, i / 8) + (34,))
    canvas.alpha_composite(sun.filter(ImageFilter.GaussianBlur(sun_r * 0.03)))
    fl = layer(canvas.size)
    fd = ImageDraw.Draw(fl)
    fd.rectangle([0, horizon, w, h], fill=(26, 6, 56, 255))
    y, gap = horizon, sun_r * 0.05
    step = 1.0
    while y < h:
        fd.line([(0, y), (w, y)], fill=MAGENTA + (110,), width=max(2, SS))
        gap *= 1.28
        y += gap
    for i in range(-14, 15):
        fd.line([(cx + i * w * 0.02, horizon), (cx + i * w * 0.16, h)], fill=MAGENTA + (90,), width=max(2, SS))
    canvas.alpha_composite(fl)


def planet(canvas, cx, cy, r, kind='normal', ring_gap=0.5, dim=1.0, orbit_k=1.32):
    c1, c2 = RIM[kind]
    n = 72
    ring = layer(canvas.size)
    rd = ImageDraw.Draw(ring)
    rr = r * (1 + ring_gap)
    rd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=c1 + (int(60 * dim),), width=max(2, SS))
    orb_r = r * orbit_k
    rd.ellipse([cx - orb_r, cy - orb_r, cx + orb_r, cy + orb_r], outline=c1 + (int(55 * dim),), width=max(1, SS // 2 + 1))
    canvas.alpha_composite(ring)
    body = layer(canvas.size)
    bd = ImageDraw.Draw(body)
    bd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(12, 6, 64, 255))
    bd.ellipse([cx - r * 0.85, cy - r * 0.9, cx + r * 0.25, cy + r * 0.2], fill=lerp(c1, (12, 6, 64), 0.85) + (150,))
    canvas.alpha_composite(body)

    def arcs(d, width, alpha):
        for i in range(n):
            a0 = -180 + i * 360 / n - 0.6
            a1 = a0 + 360 / n + 1.2
            mid = math.radians((a0 + a1) / 2)
            t = (1 - math.cos(mid + math.pi * 0.75)) / 2
            d.arc([cx - r, cy - r, cx + r, cy + r], a0, a1, fill=lerp(c1, c2, t) + (alpha,), width=width)
    glow(canvas, lambda d: arcs(d, int(r * 0.22), 230), r * 0.14, 2)
    l = layer(canvas.size)
    arcs(ImageDraw.Draw(l), max(int(r * 0.06), 3 * SS), 255)
    canvas.alpha_composite(l)


def mine(canvas, cx, cy, r, rot=0.3):
    near = layer(canvas.size)
    ImageDraw.Draw(near).ellipse([cx - r * 3.4, cy - r * 3.4, cx + r * 3.4, cy + r * 3.4], outline=RED + (70,), width=max(2, SS))
    canvas.alpha_composite(near)
    glow(canvas, lambda d: d.ellipse([cx - r * 1.5, cy - r * 1.5, cx + r * 1.5, cy + r * 1.5], fill=RED + (200,)), r * 0.9, 2)
    l = layer(canvas.size)
    d = ImageDraw.Draw(l)
    for i in range(6):
        a = math.pi / 3 * i + rot
        d.line([(cx + math.cos(a) * r, cy + math.sin(a) * r), (cx + math.cos(a) * r * 1.55, cy + math.sin(a) * r * 1.55)], fill=RED + (255,), width=int(r * 0.22))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(42, 5, 16, 255), outline=RED + (255,), width=int(r * 0.2))
    canvas.alpha_composite(l)


def orb(canvas, cx, cy, r):
    glow(canvas, lambda d: d.ellipse([cx - r * 1.6, cy - r * 1.6, cx + r * 1.6, cy + r * 1.6], fill=(255, 255, 255, 170)), r * 0.8, 2)
    l = layer(canvas.size)
    d = ImageDraw.Draw(l)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255, 230), width=max(int(r * 0.16), 2))
    d.ellipse([cx - r * 0.5, cy - r * 0.5, cx + r * 0.5, cy + r * 0.5], fill=(255, 255, 255, 255))
    canvas.alpha_composite(l)


def ship(canvas, cx, cy, size, heading):
    def pt(l, side):
        return (cx + math.cos(heading) * l - math.sin(heading) * side, cy + math.sin(heading) * l + math.cos(heading) * side)
    nose, left, right, back = pt(size * 1.7, 0), pt(-size, -size * 0.95), pt(-size, size * 0.95), pt(-size * 0.4, 0)
    glow(canvas, lambda d: d.ellipse([cx - size * 2, cy - size * 2, cx + size * 2, cy + size * 2], fill=CYAN + (200,)), size * 1.2, 2)
    l = layer(canvas.size)
    d = ImageDraw.Draw(l)
    d.polygon([nose, left, back], fill=(255, 255, 255, 255))
    d.polygon([nose, right, back], fill=(214, 240, 255, 255))
    d.line([nose, left, right, nose], fill=CYAN + (255,), width=max(int(size * 0.18), 2), joint='curve')
    canvas.alpha_composite(l)


def trail(canvas, points, width):
    # densify the polyline, then stamp round dots so there are no visible segment seams
    dense = []
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        n = max(int(math.hypot(x1 - x0, y1 - y0) / (width * 0.25)), 1)
        dense += [(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n) for k in range(n)]
    m = len(dense)
    gl = layer(canvas.size)
    core = layer(canvas.size)
    gd, cd = ImageDraw.Draw(gl), ImageDraw.Draw(core)
    for i, (x, y) in enumerate(dense):
        f = i / m
        col = lerp(VIOLET, YELLOW, f)
        rg = width * (0.7 + 1.7 * f)
        rc = width * (0.3 + 0.75 * f)
        gd.ellipse([x - rg, y - rg, x + rg, y + rg], fill=col + (int(30 + 60 * f),))
        cd.ellipse([x - rc, y - rc, x + rc, y + rc], fill=col + (int(70 + 185 * f),))
    canvas.alpha_composite(gl.filter(ImageFilter.GaussianBlur(width * 1.3)))
    canvas.alpha_composite(gl.filter(ImageFilter.GaussianBlur(width * 0.6)))
    canvas.alpha_composite(core)


def text_glow(canvas, xy, text, size, fill, glow_col, italic=False, anchor='mm'):
    f = ImageFont.truetype(FONT_I if italic else FONT, size)
    glow(canvas, lambda d: d.text(xy, text, font=f, fill=glow_col + (255,), anchor=anchor, stroke_width=int(size * 0.05), stroke_fill=glow_col + (255,)), size * 0.16, 2)
    ImageDraw.Draw(canvas).text(xy, text, font=f, fill=fill + (255,), anchor=anchor)


def flare(canvas, cx, cy, r):
    glow(canvas, lambda d: d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 240, 200, 255)), r * 0.6, 2)
    l = layer(canvas.size)
    d = ImageDraw.Draw(l)
    for ang in (0, 90):
        a = math.radians(ang)
        d.line([(cx - math.cos(a) * r * 3, cy - math.sin(a) * r * 3), (cx + math.cos(a) * r * 3, cy + math.sin(a) * r * 3)], fill=(255, 235, 190, 200), width=max(int(r * 0.12), 2))
    canvas.alpha_composite(l.filter(ImageFilter.GaussianBlur(1.5)))


def scene(w, h, cfg, seed):
    W, H = w * SS, h * SS
    u = min(W, H)
    canvas = gradient(W, H)
    stars(canvas, seed, int(W * H / 9000))
    synth_floor(canvas, H * cfg['horizon'], u * 0.30)

    P = {k: (v[0] * W, v[1] * H, v[2] * u, v[3]) for k, v in cfg['planets'].items()}
    for k in cfg['planets']:
        x, y, r, kind = P[k]
        planet(canvas, x, y, r, kind, dim=1.0)

    # ship path: orbit arc around A, release along the tangent toward B, stop at B's gravity ring
    ax, ay, ar, _ = P['A']
    bx, by, br, _ = P['B']
    orbit_r = ar * 1.32
    dx, dy = bx - ax, by - ay
    dist = math.hypot(dx, dy)
    ux, uy = dx / dist, dy / dist
    a = math.atan2(-ux, uy)
    p0 = (ax + math.cos(a) * orbit_r, ay + math.sin(a) * orbit_r)
    tx, ty = -math.sin(a), math.cos(a)
    # ensure the tangent heads toward B (otherwise flip orbit direction)
    if tx * ux + ty * uy < 0:
        a += math.pi
        p0 = (ax + math.cos(a) * orbit_r, ay + math.sin(a) * orbit_r)
        tx, ty = -math.sin(a), math.cos(a)
    line_len = math.hypot(bx - p0[0], by - p0[1]) - br * 1.5
    end = (p0[0] + tx * line_len, p0[1] + ty * line_len)
    arc_span = math.radians(cfg['arc_deg'])
    pts = [(ax + math.cos(a - arc_span + arc_span * i / 26) * orbit_r, ay + math.sin(a - arc_span + arc_span * i / 26) * orbit_r) for i in range(27)]
    pts += [(p0[0] + tx * line_len * j / 20, p0[1] + ty * line_len * j / 20) for j in range(1, 21)]

    # mine skimmed near the path
    t = cfg['mine_t']
    mr = u * cfg['mine_r']
    mpos = (p0[0] + tx * line_len * t + (-ty) * mr * 2.2 * cfg['mine_side'], p0[1] + ty * line_len * t + tx * mr * 2.2 * cfg['mine_side'])
    mine(canvas, mpos[0], mpos[1], mr)
    for name, (ox, oy) in cfg.get('extra_mines', {}).items():
        mine(canvas, ox * W, oy * H, mr * 0.85)
    orb(canvas, cfg['orb'][0] * W, cfg['orb'][1] * H, u * 0.028)

    trail(canvas, pts, u * 0.012)
    flare(canvas, mpos[0] - (-ty) * mr * 1.0 * cfg['mine_side'], mpos[1] - tx * mr * 1.0 * cfg['mine_side'], u * 0.012)
    ship(canvas, end[0], end[1], u * 0.022, math.atan2(ty, tx))

    text_glow(canvas, (W * cfg['score'][0], H * cfg['score'][1]), '128', int(u * cfg['score_size']), (255, 255, 255), CYAN)
    text_glow(canvas, (W * cfg['score'][0], H * cfg['score'][1] + u * cfg['score_size'] * 0.78), 'x3', int(u * cfg['score_size'] * 0.42), ORANGE, ORANGE)
    text_glow(canvas, (mpos[0] + (-ty) * mr * 3.2 * cfg['mine_side'] - tx * mr * 1.4, mpos[1] + tx * mr * 3.2 * cfg['mine_side'] - ty * mr * 1.4), 'SKIM +15', int(u * 0.045), ORANGE, ORANGE, italic=True)

    return canvas.convert('RGB').resize((w, h), Image.LANCZOS)


CFG_1x1 = dict(
    horizon=0.90, arc_deg=75, mine_t=0.62, mine_r=0.03, mine_side=1, orb=(0.88, 0.62), score=(0.5, 0.085), score_size=0.11,
    planets={'A': (0.27, 0.70, 0.13, 'normal'), 'B': (0.74, 0.30, 0.085, 'fast'), 'C': (0.16, 0.24, 0.05, 'crumble'), 'D': (0.90, 0.85, 0.045, 'normal')},
)
CFG_5x7 = dict(
    horizon=0.92, arc_deg=75, mine_t=0.62, mine_r=0.03, mine_side=1, orb=(0.88, 0.60), score=(0.5, 0.075), score_size=0.13,
    planets={'A': (0.28, 0.72, 0.15, 'normal'), 'B': (0.72, 0.38, 0.10, 'fast'), 'C': (0.20, 0.30, 0.06, 'crumble'), 'D': (0.82, 0.16, 0.05, 'normal')},
)
CFG_16x9 = dict(
    horizon=0.90, arc_deg=75, mine_t=0.62, mine_r=0.045, mine_side=1, orb=(0.60, 0.80), score=(0.13, 0.15), score_size=0.15,
    planets={'A': (0.27, 0.68, 0.20, 'normal'), 'B': (0.70, 0.36, 0.13, 'fast'), 'C': (0.93, 0.20, 0.07, 'crumble'), 'D': (0.90, 0.84, 0.07, 'normal')},
)

if __name__ == '__main__':
    out = os.path.join(os.path.dirname(__file__), 'thumbnails')
    os.makedirs(out, exist_ok=True)
    for name, (w, h), cfg, seed in [
        ('thumb_1x1_1440x1440.png', (1440, 1440), CFG_1x1, 1),
        ('thumb_5x7_1250x1750.png', (1250, 1750), CFG_5x7, 2),
        ('thumb_16x9_1920x1080.png', (1920, 1080), CFG_16x9, 3),
    ]:
        scene(w, h, cfg, seed).save(os.path.join(out, name), optimize=True)
        print('wrote', name)
