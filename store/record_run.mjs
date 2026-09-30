// Plays the real game logic (src/game/world.js) with a bot and records a 30 fps trace for the preview video.
// Picks the best-looking seed: no death, many hops, several skims, at least one orb. Run: node store/record_run.mjs
import { writeFileSync } from 'node:fs';
import { createWorld, release, step } from '../src/game/world.js';

const SECONDS = 12;
const HZ = 60;

function botWantsRelease(w, margin) {
  const s = w.ship;
  if (s.mode !== 'orbit') return false;
  const target = w.planets.find((q) => q.i === s.pi + 1);
  if (!target) return false;
  const vx = -Math.sin(s.angle) * s.dir;
  const vy = Math.cos(s.angle) * s.dir;
  const dx = target.x - s.x;
  const dy = target.y - s.y;
  const along = dx * vx + dy * vy;
  const perp = Math.abs(dx * vy - dy * vx);
  if (along <= 0 || perp > target.ring * 0.55) return false;
  // Don't pick a line that flies straight through a mine, but allow close passes (those are the skims).
  return w.mines.every((m) => {
    const mx = m.x - s.x;
    const my = m.y - s.y;
    const al = mx * vx + my * vy;
    return !(al > 0 && al < along && Math.abs(mx * vy - my * vx) < margin);
  });
}

function play(seed, margin) {
  const w = createWorld(seed);
  const frames = [];
  let near = 0, orbs = 0, releases = 0, firstNear = null, firstOrb = null;
  const total = SECONDS * HZ;
  let pending = [];
  // start with a short beat of orbiting before the first release
  for (let n = 0; n < total; n++) {
    const events = [];
    if (n > 30 && botWantsRelease(w, margin) && release(w)) { events.push({ type: 'release' }); releases++; }
    events.push(...step(w, 1 / HZ, true));
    for (const e of events) {
      if (e.type === 'near') { near++; if (firstNear === null) firstNear = n / HZ; }
      if (e.type === 'orb') { orbs++; if (firstOrb === null) firstOrb = n / HZ; }
    }
    pending.push(...events);
    if (w.over) return { ok: false };
    if (n % 2 === 1) {
      const s = w.ship;
      frames.push({
        cam: w.camY, time: w.time, score: w.score, hops: w.hops, streak: w.streak, slow: w.slow,
        ship: { x: s.x, y: s.y, vx: s.vx, vy: s.vy, mode: s.mode, angle: s.angle, dir: s.dir },
        planets: w.planets.map((p) => ({ i: p.i, x: p.x, y: p.y, r: p.r, ring: p.ring, orbitR: p.orbitR, type: p.type, spent: p.spent, life: p.life, active: s.mode === 'orbit' && s.pi === p.i })),
        mines: w.mines.map((m) => ({ x: m.x, y: m.y, r: m.r, nearR: m.nearR })),
        orbs: w.orbs.filter((o) => !o.taken).map((o) => ({ x: o.x, y: o.y, r: o.r })),
        events: pending,
      });
      pending = [];
    }
  }
  return { ok: true, frames, firstNear, firstOrb, near, orbs, hops: w.hops, score: w.score, releases };
}

let best = null;
for (const margin of [22, 24, 28, 32]) {
  for (let seed = 1; seed <= 3000; seed++) {
    const r = play(seed, margin);
    if (!r.ok || r.orbs < 1 || r.near < 3 || r.hops < 9) continue;
    // captions need room: first skim early, first orb in the first two thirds of the clip
    if (r.firstNear > 7 || r.firstOrb > 9 || r.firstOrb < 3.5) continue;
    const value = r.score + r.near * 20 + r.orbs * 10;
    if (!best || value > best.value) best = { ...r, seed, margin, value };
  }
}
if (!best) { console.error('no suitable seed found'); process.exit(1); }
console.log(`first skim ${best.firstNear}s, first orb ${best.firstOrb}s`);
console.log(`seed ${best.seed} margin ${best.margin}: hops ${best.hops} skims ${best.near} orbs ${best.orbs} score ${best.score}`);
writeFileSync(new URL('./run.json', import.meta.url), JSON.stringify({ fps: 30, frames: best.frames }));
