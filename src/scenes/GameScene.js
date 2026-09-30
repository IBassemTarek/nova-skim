import Phaser from 'phaser';
import platform from '../platform.js';
import audio from '../audio.js';
import { W, H, SHIP_R, SLOW_TIME, createWorld, release, step, multiplier } from '../game/world.js';

const C = {
  magenta: 0xff2bd6,
  cyan: 0x22e6ff,
  orange: 0xff9a3c,
  red: 0xff3355,
  violet: 0x7a3cff,
  white: 0xffffff,
  planetFill: 0x0c0640,
  yellow: 0xffc23c,
};
const FONT = 'Trebuchet MS, Verdana, Arial, sans-serif';
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const PLANET_COLOR = { normal: C.magenta, fast: C.cyan, crumble: C.orange };
// Rim gradients (light side -> shadow side), matching the logo's cyan-to-magenta planet.
const RIM = { normal: [C.cyan, C.magenta], fast: [0xb8f7ff, 0x4b7bff], crumble: [C.yellow, 0xff3c8e] };
const RIM_SEGMENTS = 28;
const lerpColor = (a, b, t) => {
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.IntegerToColor(a), Phaser.Display.Color.IntegerToColor(b), 100, t * 100);
  return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
};

export default class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  preload() {
    this.load.image('logo', 'logo.png');
  }

  create() {
    const saved = platform.data;
    this.best = Number.isFinite(saved.best) ? Math.max(0, Math.floor(saved.best)) : 0;
    this.tutorialDone = !!saved.tutorialDone;
    this.reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    this.makeBackground();
    this.g = this.add.graphics().setDepth(2);
    this.stars = Array.from({ length: 70 }, (_, i) => ({
      x: (i * 173) % W, y: (i * 389) % H, z: 0.2 + ((i * 37) % 10) / 14, s: 1 + (i % 3),
    }));
    this.particles = [];
    this.trail = [];
    this.popups = [];

    this.scoreText = this.add.text(W / 2, 70, '0', { fontFamily: FONT, fontSize: '96px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5).setDepth(10).setShadow(0, 0, hex(C.cyan), 18, true, true).setPadding(36, 28);
    this.multText = this.add.text(W / 2, 140, '', { fontFamily: FONT, fontSize: '36px', fontStyle: 'bold', color: hex(C.orange) })
      .setOrigin(0.5).setDepth(10).setShadow(0, 0, hex(C.orange), 12, true, true).setPadding(36, 28);
    this.bestText = this.add.text(W - 24, 28, '', { fontFamily: FONT, fontSize: '26px', color: '#c9b8ff' })
      .setOrigin(1, 0).setDepth(10);
    this.overlay = this.add.container(0, 0).setDepth(20);
    this.rimColors = {};
    for (const [type, [c1, c2]] of Object.entries(RIM)) {
      this.rimColors[type] = Array.from({ length: RIM_SEGMENTS }, (_, i) => {
        const a = ((i + 0.5) / RIM_SEGMENTS) * Math.PI * 2 - Math.PI;
        return lerpColor(c1, c2, (1 - Math.cos(a + Math.PI * 0.75)) / 2);
      });
    }

    this.input.on('pointerdown', () => this.onTap());
    this.input.keyboard.on('keydown-SPACE', () => this.onTap());
    this.input.keyboard.on('keydown-ESC', () => { if (this.state === 'over') this.reset(); });
    platform.onPause(() => this.setPaused(true));
    platform.onResume(() => this.setPaused(false));
    audio.setEnabled(platform.isAudioEnabled());
    platform.onAudioChange((on) => audio.setEnabled(on));

    this.reset();
    // Scene is fully built: signal readiness now rather than waiting on a rendered frame.
    platform.firstFrameReady();
    platform.gameReady();
    if (this.best > 0) platform.sendScore(this.best);
  }

  makeBackground() {
    const tex = this.textures.createCanvas('bg', W, H);
    const ctx = tex.getContext();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#060326');
    grad.addColorStop(0.55, '#150a48');
    grad.addColorStop(1, '#360a5a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    tex.refresh();
    this.add.image(0, 0, 'bg').setOrigin(0).setDepth(0);
  }

  // ---------- run lifecycle ----------
  reset() {
    this.world = createWorld();
    this.state = 'ready';
    this.startBest = this.best;
    this.trail.length = 0;
    this.particles.length = 0;
    this.popups.forEach((p) => p.destroy());
    this.popups.length = 0;
    this.overlay.removeAll(true);
    this.shownScore = 0;
    this.scoreText.setText('0').setAlpha(0.5);
    this.multText.setText('');
    this.bestText.setText(this.best > 0 ? `BEST ${this.best}` : '');
    this.showReady();
  }

  showReady() {
    const logo = this.add.image(W / 2, 300, 'logo').setDisplaySize(400, 400);
    this.tweens.add({ targets: logo, y: 314, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const title = this.add.text(W / 2, 560, 'NOVA SKIM', { fontFamily: FONT, fontSize: '84px', fontStyle: 'italic bold', color: '#8ff4ff' })
      .setOrigin(0.5).setShadow(0, 0, hex(C.magenta), 26, true, true).setPadding(36, 28);
    const sub = this.add.text(W / 2, 650, 'tap to release  •  land on planets  •  skim the mines', { fontFamily: FONT, fontSize: '26px', color: '#c9b8ff' }).setOrigin(0.5);
    const start = this.add.text(W / 2, 1010, 'TAP TO START', { fontFamily: FONT, fontSize: '46px', fontStyle: 'bold', color: hex(C.cyan) })
      .setOrigin(0.5).setShadow(0, 0, hex(C.cyan), 16, true, true).setPadding(36, 28);
    this.tweens.add({ targets: start, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });
    this.overlay.add([logo, title, sub, start]);
  }

  startRun() {
    this.state = 'play';
    this.overlay.removeAll(true);
    this.scoreText.setAlpha(1);
    audio.unlock();
  }

  onTap() {
    audio.unlock();
    if (this.state === 'ready') { this.startRun(); return; }
    if (this.state === 'over') { if (this.time.now - this.overAt > 600) this.reset(); return; }
    if (this.state === 'play' && release(this.world)) {
      audio.release();
      if (!this.tutorialDone && this.world.hops >= 2) { this.tutorialDone = true; platform.save({ tutorialDone: true }); }
    }
  }

  endRun() {
    this.state = 'over';
    this.overAt = this.time.now;
    audio.over();
    const w = this.world;
    const isBest = w.score > this.startBest;
    if (isBest) this.best = w.score;
    this.saveProgress();
    platform.sendScore(w.score);
    if (!this.reduceMotion) this.cameras.main.shake(300, 0.012);
    this.burst(w.ship.x, w.ship.y, C.red, 40, 420);
    this.trail.length = 0;
    this.time.delayedCall(350, () => { if (this.state === 'over' && isBest) audio.best(); });

    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x07021a, 0.55);
    const t1 = this.add.text(W / 2, 400, 'GAME OVER', { fontFamily: FONT, fontSize: '80px', fontStyle: 'italic bold', color: '#ffffff' })
      .setOrigin(0.5).setShadow(0, 0, hex(C.red), 24, true, true).setPadding(36, 28);
    const t2 = this.add.text(W / 2, 540, `${w.score}`, { fontFamily: FONT, fontSize: '150px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5).setShadow(0, 0, hex(C.cyan), 24, true, true).setPadding(36, 28);
    const t3 = this.add.text(W / 2, 650, isBest ? 'NEW BEST!' : `BEST ${this.best}`, { fontFamily: FONT, fontSize: '40px', fontStyle: 'bold', color: isBest ? hex(C.orange) : '#c9b8ff' })
      .setOrigin(0.5);
    const t4 = this.add.text(W / 2, 720, `${w.hops} hops`, { fontFamily: FONT, fontSize: '28px', color: '#c9b8ff' }).setOrigin(0.5);
    const t5 = this.add.text(W / 2, 900, 'TAP TO RETRY', { fontFamily: FONT, fontSize: '46px', fontStyle: 'bold', color: hex(C.cyan) })
      .setOrigin(0.5).setShadow(0, 0, hex(C.cyan), 16, true, true).setPadding(36, 28);
    this.tweens.add({ targets: t5, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });
    this.overlay.add([dim, t1, t2, t3, t4, t5]);
  }

  saveProgress() {
    platform.save({ best: this.best, tutorialDone: this.tutorialDone });
  }

  setPaused(paused) {
    if (paused) {
      this.saveProgress();
      audio.suspend();
      this.game.loop.sleep();
    } else {
      this.game.loop.wake();
      audio.resume();
    }
  }

  // ---------- frame loop ----------
  update(_, delta) {
    const dt = delta / 1000;
    const w = this.world;
    const events = this.state === 'over' ? [] : step(w, dt, this.state === 'play');
    for (const e of events) this.onEvent(e);
    if (w.over && this.state !== 'over') this.endRun();

    const ts = w.slow > 0 ? 0.5 : 1;
    this.updateParticles(dt * ts);
    if (this.state !== 'over') {
      this.trail.push({ x: w.ship.x, y: w.ship.y, t: 0 });
      if (this.trail.length > 26) this.trail.shift();
    }
    this.trail.forEach((p) => { p.t += dt; });

    if (this.shownScore !== w.score) {
      this.shownScore = w.score;
      this.scoreText.setText(`${w.score}`);
    }
    const m = multiplier(w);
    this.multText.setText(m > 1 ? `x${m}` : '');
    this.draw();
  }

  onEvent(e) {
    const w = this.world;
    if (e.type === 'hop') {
      audio.hop(w.hops - 1, w.streak);
      platform.sendScore(w.score);
      this.burst(e.x, e.y, C.cyan, 14, 220);
      this.popup(e.x, e.y - 90, `+${e.pts}`, C.cyan);
      if (!this.reduceMotion) this.cameras.main.shake(90, 0.003 * e.mult);
    } else if (e.type === 'near') {
      audio.near(w.streak);
      this.burst(e.x, e.y, C.orange, 10, 180);
      this.popup(e.x, e.y - 40, `SKIM +${e.pts}`, C.orange);
    } else if (e.type === 'orb') {
      audio.orb();
      this.burst(e.x, e.y, C.white, 18, 260);
      this.popup(e.x, e.y - 40, 'SLOW-MO +25', C.white);
    } else if (e.type === 'crumble') {
      audio.crumble();
      this.burst(e.x, e.y, C.orange, 26, 320);
    } else if (e.type === 'boom') {
      this.burst(e.x, e.y, C.red, 20, 300);
    }
  }

  popup(wx, wy, text, color) {
    const t = this.add.text(wx, wy - this.world.camY, text, { fontFamily: FONT, fontSize: '34px', fontStyle: 'bold', color: hex(color) })
      .setOrigin(0.5).setDepth(12).setShadow(0, 0, hex(color), 10, true, true).setPadding(36, 28);
    this.popups.push(t);
    this.tweens.add({
      targets: t, y: t.y - 70, alpha: 0, duration: 800, ease: 'Cubic.easeOut',
      onComplete: () => { t.destroy(); this.popups = this.popups.filter((p) => p !== t); },
    });
  }

  burst(x, y, color, n, speed) {
    if (this.reduceMotion) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.4 + Math.random() * 0.5, color, size: 2 + Math.random() * 3 });
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; }
    this.particles = this.particles.filter((p) => p.life < p.max);
  }

  // ---------- rendering ----------
  glowCircle(x, y, r, color, width, alpha = 1) {
    const g = this.g;
    g.lineStyle(width + 10, color, 0.08 * alpha); g.strokeCircle(x, y, r);
    g.lineStyle(width + 5, color, 0.18 * alpha); g.strokeCircle(x, y, r);
    g.lineStyle(width, color, alpha); g.strokeCircle(x, y, r);
  }

  rim(x, y, r, type, alpha) {
    const g = this.g;
    const cols = this.rimColors[type];
    const step = (Math.PI * 2) / RIM_SEGMENTS;
    for (let i = 0; i < RIM_SEGMENTS; i++) {
      const a0 = -Math.PI + i * step - 0.02;
      const a1 = a0 + step + 0.04;
      g.lineStyle(9, cols[i], 0.16 * alpha);
      g.beginPath(); g.arc(x, y, r, a0, a1); g.strokePath();
      g.lineStyle(3, cols[i], alpha);
      g.beginPath(); g.arc(x, y, r, a0, a1); g.strokePath();
    }
  }

  draw() {
    const g = this.g;
    const w = this.world;
    const cy = w.camY;
    g.clear();

    // stars (parallax)
    for (const s of this.stars) {
      const sy = (((s.y - cy * 0.12 * s.z) % H) + H) % H;
      g.fillStyle(C.white, 0.25 + s.z * 0.4);
      g.fillRect(s.x, sy, s.s, s.s);
    }

    // synthwave sun and scrolling floor grid
    const horizon = 1010;
    for (let i = 0; i < 7; i++) {
      const r = 190;
      g.fillStyle(i % 2 ? C.magenta : C.orange, 0.05 + i * 0.006);
      g.fillCircle(W / 2, horizon - 40, r - i * 4);
    }
    g.fillStyle(0x1a0638, 1);
    g.fillRect(0, horizon, W, H - horizon);
    g.lineStyle(2, C.magenta, 0.35);
    const offset = (-cy * 0.6) % 46;
    for (let y = horizon + offset; y < H; y += 46) {
      if (y < horizon) continue;
      g.lineBetween(0, y, W, y);
    }
    for (let i = -8; i <= 8; i++) {
      g.lineBetween(W / 2 + i * 26, horizon, W / 2 + i * 150, H);
    }

    // aim hint for the first hops
    if (!this.tutorialDone && w.ship.mode === 'orbit' && this.state !== 'over') this.drawAimHint(cy);

    for (const p of w.planets) this.drawPlanet(p, cy);
    for (const m of w.mines) this.drawMine(m, cy);
    for (const o of w.orbs) if (!o.taken) this.drawOrb(o, cy);

    // trail
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const f = i / this.trail.length;
      g.lineStyle(2 + f * 8, lerpColor(0xa03cff, C.yellow, f), 0.15 + f * 0.6);
      g.lineBetween(a.x, a.y - cy, b.x, b.y - cy);
    }

    if (this.state !== 'over') this.drawShip(cy);

    for (const p of this.particles) {
      g.fillStyle(p.color, 1 - p.life / p.max);
      g.fillCircle(p.x, p.y - cy, p.size);
    }

    // slow-mo vignette bar
    if (w.slow > 0) {
      g.fillStyle(C.white, 0.5);
      g.fillRect(0, H - 8, W * (w.slow / SLOW_TIME), 8);
    }
  }

  drawAimHint(cy) {
    const g = this.g;
    const s = this.world.ship;
    const dx = -Math.sin(s.angle) * s.dir;
    const dy = Math.cos(s.angle) * s.dir;
    g.fillStyle(C.white, 0.35);
    for (let i = 1; i <= 12; i++) g.fillCircle(s.x + dx * i * 34, s.y - cy + dy * i * 34, 2.5);
  }

  drawPlanet(p, cy) {
    const g = this.g;
    const y = p.y - cy;
    if (y < -300 || y > H + 300) return;
    const color = PLANET_COLOR[p.type];
    const pulse = 0.5 + 0.5 * Math.sin(this.world.time * 3 + p.i);
    const active = this.world.ship.mode === 'orbit' && this.world.ship.pi === p.i;
    const dead = p.spent;
    // gravity ring
    g.lineStyle(2, color, dead ? 0.06 : 0.16 + pulse * 0.1);
    g.strokeCircle(p.x, y, p.ring);
    // orbit path
    g.lineStyle(1, color, dead ? 0.05 : 0.22);
    g.strokeCircle(p.x, y, p.orbitR);
    // body
    g.fillStyle(C.planetFill, 1);
    g.fillCircle(p.x, y, p.r);
    g.fillStyle(color, dead ? 0.05 : 0.14);
    g.fillCircle(p.x - p.r * 0.25, y - p.r * 0.25, p.r * 0.7);
    this.rim(p.x, y, p.r, p.type, dead ? 0.25 : 1);
    if (p.type === 'fast' && !dead) {
      g.lineStyle(2, color, 0.7);
      g.beginPath(); g.arc(p.x, y, p.r * 0.6, this.world.time * 4, this.world.time * 4 + 1.6); g.strokePath();
    }
    if (p.type === 'crumble' && !dead) {
      const f = Math.max(0, p.life / 2.4);
      g.lineStyle(active ? 6 : 3, C.orange, active ? 0.95 : 0.4);
      g.beginPath(); g.arc(p.x, y, p.ring + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); g.strokePath();
    }
  }

  drawMine(m, cy) {
    const g = this.g;
    const y = m.y - cy;
    if (y < -100 || y > H + 100) return;
    const t = this.world.time;
    g.lineStyle(1, C.red, 0.18);
    g.strokeCircle(m.x, y, m.nearR);
    g.fillStyle(C.red, 0.22 + 0.1 * Math.sin(t * 6));
    g.fillCircle(m.x, y, m.r + 6);
    g.fillStyle(0x2a0510, 1);
    g.fillCircle(m.x, y, m.r);
    this.glowCircle(m.x, y, m.r, C.red, 2.5);
    for (let i = 0; i < 6; i++) {
      const a = t * 1.5 + (i * Math.PI) / 3;
      g.lineStyle(2.5, C.red, 1);
      g.lineBetween(m.x + Math.cos(a) * m.r, y + Math.sin(a) * m.r, m.x + Math.cos(a) * (m.r + 7), y + Math.sin(a) * (m.r + 7));
    }
  }

  drawOrb(o, cy) {
    const y = o.y - cy;
    if (y < -100 || y > H + 100) return;
    const pulse = 1 + 0.15 * Math.sin(this.world.time * 5);
    this.g.fillStyle(C.white, 0.15);
    this.g.fillCircle(o.x, y, (o.r + 8) * pulse);
    this.g.fillStyle(C.white, 0.95);
    this.g.fillCircle(o.x, y, o.r * 0.6 * pulse);
    this.glowCircle(o.x, y, o.r * pulse, C.white, 2, 0.8);
  }

  drawShip(cy) {
    const g = this.g;
    const s = this.world.ship;
    const x = s.x;
    const y = s.y - cy;
    const heading = s.mode === 'orbit' ? s.angle + (s.dir * Math.PI) / 2 : Math.atan2(s.vy, s.vx);
    const pt = (l, side) => ({
      x: x + Math.cos(heading) * l - Math.sin(heading) * side,
      y: y + Math.sin(heading) * l + Math.cos(heading) * side,
    });
    const nose = pt(SHIP_R + 7, 0);
    const l = pt(-SHIP_R, -SHIP_R * 0.9);
    const r = pt(-SHIP_R, SHIP_R * 0.9);
    const back = pt(-SHIP_R * 0.4, 0);
    g.fillStyle(C.cyan, 0.18);
    g.fillCircle(x, y, SHIP_R + 12);
    g.fillStyle(C.white, 1);
    g.fillTriangle(nose.x, nose.y, l.x, l.y, back.x, back.y);
    g.fillTriangle(nose.x, nose.y, r.x, r.y, back.x, back.y);
    g.lineStyle(2, C.cyan, 1);
    g.strokeTriangle(nose.x, nose.y, l.x, l.y, r.x, r.y);
  }
}
