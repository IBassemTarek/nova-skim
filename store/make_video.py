"""Renders the Playables preview video (16:9, with generated soundtrack) from a real recorded playthrough.
The playthrough comes from store/record_run.mjs, which plays src/game/world.js with a bot, so every hop, skim and orb
follows the game's real rules. No logos or branding text: only gameplay and feature captions.
Run: node store/record_run.mjs && python3 store/make_video.py   (needs ffmpeg)
"""
import json
import math
import random
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
import make_art as art  # noqa: E402
import make_audio  # noqa: E402

HERE = Path(__file__).parent
W, H, FPS = 1920, 1080, 30
SS = 2
GW, GH = 720, 1280                      # game world size
COL_H = 1000
COL_W = round(COL_H * GW / GH)          # 562
COL_X, COL_Y = (W - COL_W) // 2, (H - COL_H) // 2
SC = SS * COL_H / GH                    # world px -> supersampled column px
CW, CH = COL_W * SS, COL_H * SS
HORIZON = 1010 / GH
SHIP_R = 9

CYAN, MAGENTA, ORANGE, YELLOW, WHITE = art.CYAN, art.MAGENTA, art.ORANGE, art.YELLOW, (255, 255, 255)

CAPTIONS = []  # filled in main(): (start_s, end_s, lines, colour, side)


def lerp(a, b, t):
    return a + (b - a) * t


# ---------- static backgrounds ----------
def make_frame_bg():
    bg = art.gradient(W, H)
    rnd = random.Random(7)
    d = ImageDraw.Draw(bg)
    for _ in range(260):
        x, y, sz = rnd.random() * W, rnd.random() * H, rnd.choice([1, 1, 2])
        d.rectangle([x, y, x + sz, y + sz], fill=(255, 255, 255, rnd.randint(70, 200)))
    return bg


def make_column_bg():
    bg = art.gradient(CW, CH)
    art.synth_floor(bg, CH * HORIZON, CH * 0.15)
    return bg


def make_frame_overlay():
    """Rounded phone-like frame: soft glow plus a cyan-to-magenta border, drawn once."""
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    box = [COL_X - 6, COL_Y - 6, COL_X + COL_W + 6, COL_Y + COL_H + 6]
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle(box, radius=54, outline=MAGENTA + (255,), width=16)
    ov.alpha_composite(glow.filter(ImageFilter.GaussianBlur(18)))
    border = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle(box, radius=54, outline=CYAN + (255,), width=5)
    ov.alpha_composite(border)
    return ov


def rounded_mask():
    m = Image.new('L', (COL_W, COL_H), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, COL_W - 1, COL_H - 1], radius=48, fill=255)
    return m


# ---------- cached sprites ----------
_cache = {}


def cached(key, make):
    if key not in _cache:
        _cache[key] = make()
    return _cache[key]


def planet_sprite(p):
    key = ('planet', p['type'], round(p['r']), round(p['ring']), round(p['orbitR']), p['spent'])
    def make():
        r = p['r'] * SC
        pad = p['ring'] * SC * 1.25
        size = int(2 * pad)
        spr = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        art.planet(spr, size / 2, size / 2, r, p['type'], ring_gap=(p['ring'] - p['r']) / p['r'], dim=0.3 if p['spent'] else 1.0,
                   orbit_k=p['orbitR'] / p['r'])
        return spr
    return cached(key, make)


def mine_sprite(rot_idx, r):
    def make():
        rr = r * SC * 1.5
        size = int(rr * 8)
        spr = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        art.mine(spr, size / 2, size / 2, rr, rot=rot_idx * math.pi / 3 / 12)
        return spr
    return cached(('mine', rot_idx, r), make)


def orb_sprite(r):
    def make():
        rr = r * SC * 1.4
        size = int(rr * 6)
        spr = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        art.orb(spr, size / 2, size / 2, rr)
        return spr
    return cached(('orb', r), make)


def text_sprite(text, size, fill, glow_col, italic=False):
    def make():
        f = ImageFont.truetype(art.FONT_I if italic else art.FONT, size)
        box = ImageDraw.Draw(Image.new('RGBA', (1, 1))).textbbox((0, 0), text, font=f, anchor='lt')
        w, h = box[2] - box[0] + size, box[3] - box[1] + size
        spr = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        art.text_glow(spr, (w / 2, h / 2), text, size, fill, glow_col, italic=italic)
        return spr
    return cached(('text', text, size, fill, glow_col, italic), make)


def paste(canvas, spr, cx, cy, alpha=1.0):
    x, y = int(cx - spr.width / 2), int(cy - spr.height / 2)
    if x >= canvas.width or y >= canvas.height or x + spr.width <= 0 or y + spr.height <= 0:
        return
    if alpha < 1.0:
        spr = spr.copy()
        spr.putalpha(spr.getchannel('A').point(lambda v: int(v * alpha)))
    canvas.alpha_composite(spr, (max(x, 0), max(y, 0)), (max(-x, 0), max(-y, 0), spr.width, spr.height)) if (x < 0 or y < 0) else canvas.alpha_composite(
        spr.crop((0, 0, min(spr.width, canvas.width - x), min(spr.height, canvas.height - y))), (x, y))


# ---------- particles and popups (driven by the recorded events) ----------
class Effects:
    def __init__(self):
        self.parts = []
        self.pops = []
        self.rnd = random.Random(4)

    def burst(self, x, y, color, n, speed):
        for _ in range(n):
            a = self.rnd.random() * math.tau
            v = speed * (0.3 + self.rnd.random() * 0.7)
            self.parts.append([x, y, math.cos(a) * v, math.sin(a) * v, 0.0, 0.4 + self.rnd.random() * 0.5, color, 2 + self.rnd.random() * 3])

    def popup(self, x, y, text, color):
        self.pops.append({'x': x, 'y': y, 'text': text, 'color': color, 'age': 0.0})

    def feed(self, fr):
        for e in fr['events']:
            if e['type'] == 'hop':
                self.burst(e['x'], e['y'], CYAN, 14, 220)
                self.popup(e['x'], e['y'] - 90, f"+{e['pts']}", CYAN)
            elif e['type'] == 'near':
                self.burst(e['x'], e['y'], ORANGE, 10, 180)
                self.popup(e['x'], e['y'] - 40, f"SKIM +{e['pts']}", ORANGE)
            elif e['type'] == 'orb':
                self.burst(e['x'], e['y'], WHITE, 18, 260)
                self.popup(e['x'], e['y'] - 40, 'SLOW-MO +25', WHITE)

    def step(self, dt):
        for p in self.parts:
            p[4] += dt
            p[0] += p[2] * dt
            p[1] += p[3] * dt
            p[2] *= 0.96 ** (dt * 60)
            p[3] *= 0.96 ** (dt * 60)
        self.parts = [p for p in self.parts if p[4] < p[5]]
        for q in self.pops:
            q['age'] += dt
        self.pops = [q for q in self.pops if q['age'] < 0.8]


# ---------- one frame ----------
def sx(x):
    return x * SC


def draw_column(col, fr, fx):
    cam = fr['cam']
    d = ImageDraw.Draw(col)
    # parallax stars
    for i in range(70):
        x, y0, z, s = (i * 173) % GW, (i * 389) % GH, 0.2 + ((i * 37) % 10) / 14, 1 + (i % 3)
        y = ((y0 - cam * 0.12 * z) % GH + GH) % GH
        d.rectangle([x * SC, y * SC, x * SC + s * SS, y * SC + s * SS], fill=(255, 255, 255, int(255 * (0.25 + z * 0.4))))

    for p in fr['planets']:
        y = p['y'] - cam
        if y < -300 or y > GH + 300:
            continue
        paste(col, planet_sprite(p), sx(p['x']), y * SC)
        if p['type'] == 'fast' and not p['spent']:
            a = math.degrees(fr['time'] * 4)
            d.arc([sx(p['x'] - p['r'] * 0.6), (y - p['r'] * 0.6) * SC, sx(p['x'] + p['r'] * 0.6), (y + p['r'] * 0.6) * SC], a, a + 92, fill=CYAN + (180,), width=2 * SS)
        if p['type'] == 'crumble' and not p['spent']:
            f = max(0.0, p['life'] / 2.4)
            rr = (p['ring'] + 6) * SC
            d.arc([sx(p['x']) - rr, y * SC - rr, sx(p['x']) + rr, y * SC + rr], -90, -90 + 360 * f,
                  fill=ORANGE + ((240 if p['active'] else 100),), width=(6 if p['active'] else 3) * SS)

    for m in fr['mines']:
        y = m['y'] - cam
        if -100 < y < GH + 100:
            rot = int(fr['time'] * 1.5 / (math.pi / 3) * 12) % 12
            paste(col, mine_sprite(rot, m['r']), sx(m['x']), y * SC)
    for o in fr['orbs']:
        y = o['y'] - cam
        if -100 < y < GH + 100:
            paste(col, orb_sprite(o['r']), sx(o['x']), y * SC)


def draw_trail_ship(col, hist, fr):
    cam = fr['cam']
    pts = [(sx(x), (y - c) * SC) for x, y, c in hist[-18:]]
    if len(pts) >= 3:
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        pad = 60 * SS
        x0, y0 = int(min(xs) - pad), int(min(ys) - pad)
        x1, y1 = int(max(xs) + pad), int(max(ys) + pad)
        local = Image.new('RGBA', (x1 - x0, y1 - y0), (0, 0, 0, 0))
        art.trail(local, [(x - x0, y - y0) for x, y in pts], 6.5 * SC)
        x0c, y0c = max(x0, 0), max(y0, 0)
        crop = local.crop((x0c - x0, y0c - y0, min(x1, CW) - x0, min(y1, CH) - y0))
        col.alpha_composite(crop, (x0c, y0c))
    s = fr['ship']
    heading = s['angle'] + s['dir'] * math.pi / 2 if s['mode'] == 'orbit' else math.atan2(s['vy'], s['vx'])
    size = int(SHIP_R * SC * 8)
    spr = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    art.ship(spr, size / 2, size / 2, SHIP_R * SC * 1.5, heading)
    paste(col, spr, sx(s['x']), (s['y'] - cam) * SC)


def draw_hud(col, fr, fx):
    cam = fr['cam']
    for p in fx.parts:
        a = 1 - p[4] / p[5]
        r = p[7] * SS
        ImageDraw.Draw(col).ellipse([sx(p[0]) - r, (p[1] - cam) * SC - r, sx(p[0]) + r, (p[1] - cam) * SC + r], fill=p[6] + (int(255 * a),))
    for q in fx.pops:
        t = q['age'] / 0.8
        spr = text_sprite(q['text'], int(34 * SC), q['color'], q['color'])
        paste(col, spr, sx(q['x']), (q['y'] - cam) * SC - 70 * SC * (1 - (1 - t) ** 3), alpha=1 - t)
    paste(col, text_sprite(str(fr['score']), int(96 * SC), WHITE, CYAN), CW / 2, 70 * SC)
    if fr['streak'] > 0:
        paste(col, text_sprite(f"x{1 + fr['streak']}", int(36 * SC), ORANGE, ORANGE), CW / 2, 140 * SC)
    if fr['slow'] > 0:
        ImageDraw.Draw(col).rectangle([0, CH - 8 * SC, CW * fr['slow'] / 1.6, CH], fill=WHITE + (130,))


def caption_alpha(t, a, b):
    return max(0.0, min(1.0, (t - a) / 0.3, (b - t) / 0.3))


def draw_captions(frame, t):
    for start, end, lines, color, side in CAPTIONS:
        a = caption_alpha(t, start, end)
        if a <= 0:
            continue
        cx = (COL_X // 2) if side == 'left' else (W - COL_X // 2)
        y = H / 2 - (len(lines) - 1) * 56
        for k, line in enumerate(lines):
            spr = text_sprite(line, 78, WHITE, color, italic=True)
            paste(frame, spr, cx + (1 - a) * (-40 if side == 'left' else 40), y + k * 112, alpha=a)


def render_frames():
    data = json.loads((HERE / 'run.json').read_text())
    frames = data['frames']
    n = len(frames)
    frame_bg, col_bg, overlay, mask = make_frame_bg(), make_column_bg(), make_frame_overlay(), rounded_mask()

    # captions timed from the recorded events
    def first(kind):
        return next((i / FPS for i, f in enumerate(frames) if any(e['type'] == kind for e in f['events'])), None)
    t_near, t_orb = first('near'), first('orb')
    CAPTIONS.append((0.4, 2.8, ['TAP TO', 'RELEASE'], CYAN, 'left'))
    if t_near is not None:
        CAPTIONS.append((max(t_near - 0.6, 3.0), t_near + 1.8, ['SKIM MINES', 'FOR COMBOS'], ORANGE, 'right'))
    if t_orb is not None:
        CAPTIONS.append((max(t_orb - 0.5, 5.0), t_orb + 1.8, ['GRAB ORBS', 'FOR SLOW-MO'], WHITE, 'left'))
    CAPTIONS.append((n / FPS - 2.4, n / FPS - 0.3, ['HOW HIGH', 'CAN YOU GO?'], MAGENTA, 'right'))

    fx, hist = Effects(), []
    for i, fr in enumerate(frames):
        fx.feed(fr)
        hist.append((fr['ship']['x'], fr['ship']['y'], fr['cam']))
        col = col_bg.copy()
        draw_column(col, fr, fx)
        draw_trail_ship(col, hist, fr)
        draw_hud(col, fr, fx)
        fx.step(1 / FPS)
        small = col.resize((COL_W, COL_H), Image.LANCZOS)
        frame = frame_bg.copy()
        frame.paste(small.convert('RGB'), (COL_X, COL_Y), mask)
        frame.alpha_composite(overlay)
        draw_captions(frame, i / FPS)
        out = frame.convert('RGB')
        fade = min(1.0, i / (FPS * 0.4), (n - 1 - i) / (FPS * 0.6))
        if fade < 1.0:
            out = Image.eval(out, lambda v: int(v * fade))
        yield out
        if i % 30 == 0:
            print(f'frame {i}/{n}', flush=True)


def main():
    data = json.loads((HERE / 'run.json').read_text())
    wav = HERE / 'preview_audio.wav'
    silent = HERE / 'preview_silent.mp4'
    out = HERE / 'nova-skim-preview-1920x1080.mp4'
    total = len(data['frames']) / FPS
    make_audio.build(wav, total, data['frames'], FPS)
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', str(silent)]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for frame in render_frames():
        p.stdin.write(frame.tobytes())
    p.stdin.close()
    p.wait()
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(silent), '-i', str(wav), '-c:v', 'copy',
                    '-af', 'loudnorm=I=-15:TP=-1.5:LRA=11', '-ar', '44100', '-c:a', 'aac', '-b:a', '192k', '-shortest',
                    '-movflags', '+faststart', str(out)], check=True)
    silent.unlink()
    wav.unlink()
    print('wrote', out.name)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'test':
        # render a few sample frames to PNG for a visual check
        for i, fr in enumerate(render_frames()):
            if i in (100, 205, 268, 335):
                fr.save(HERE / f'_test_{i}.png')
            if i > 335:
                break
    else:
        main()
