// Pure game logic for Nova Skim: no Phaser, so it can be unit-tested with node.
// World coordinates: x in 0..W, y grows downward, the camera climbs toward negative y.
export const W = 720;
export const H = 1280;
export const SHIP_SPEED = 640;
export const SHIP_R = 9;
export const SLOW_TIME = 1.6;

export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

function makePlanet(i, prev, rng) {
  const r = lerp(30, 48, rng());
  const gap = Math.max(44, 78 - i * 0.8);
  const speedUp = 1 + Math.min(i, 40) * 0.012;
  let w = lerp(1.9, 2.4, rng()) * speedUp;
  let type = 'normal';
  const roll = rng();
  if (i >= 4 && roll < 0.15) { type = 'fast'; w *= 1.5; }
  else if (i >= 8 && roll < 0.3) type = 'crumble';
  const x = prev
    ? Math.min(W - 110, Math.max(110, prev.x + lerp(-300, 300, rng())))
    : W / 2;
  const y = prev ? prev.y - lerp(250, 340, rng()) : 0;
  return { i, x, y, r, ring: r + gap, orbitR: r + 30, w, type, life: 2.4, spent: false };
}

function decorate(world, prev, planet, rng) {
  const i = planet.i;
  const mx = lerp(prev.x, planet.x, lerp(0.35, 0.65, rng()));
  const my = lerp(prev.y, planet.y, lerp(0.35, 0.65, rng()));
  const dx = planet.x - prev.x;
  const dy = planet.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = lerp(-70, 70, rng());
  const px = mx + (-dy / len) * off;
  const py = my + (dx / len) * off;
  const clear = (p) => Math.hypot(px - p.x, py - p.y) > p.ring + 34;
  if (!clear(prev) || !clear(planet) || px < 60 || px > W - 60) return;
  if (i >= 3 && rng() < Math.min(0.15 + i * 0.02, 0.6)) {
    const amp = i >= 10 && rng() < 0.5 ? lerp(40, 110, rng()) : 0;
    world.mines.push({ ox: px, x: px, y: py, r: 13, nearR: 46, amp, sp: lerp(1, 2, rng()), ph: rng() * 6.28, grazed: false });
  } else if (rng() < 0.25) {
    world.orbs.push({ x: px, y: py, r: 12, taken: false });
  }
}

function extend(world) {
  while (world.planets[world.planets.length - 1].y > world.camY - 700) {
    const prev = world.planets[world.planets.length - 1];
    const planet = makePlanet(prev.i + 1, prev, world.rng);
    world.planets.push(planet);
    decorate(world, prev, planet, world.rng);
  }
}

export function createWorld(seed = Date.now()) {
  const rng = makeRng(seed);
  const first = makePlanet(0, null, rng);
  const world = {
    rng,
    planets: [first],
    mines: [],
    orbs: [],
    ship: { mode: 'orbit', pi: 0, angle: -Math.PI / 2, dir: 1, orbitR: first.orbitR, x: first.x, y: first.y - first.orbitR, vx: 0, vy: 0, lastPi: -1, grace: false, nearThisHop: 0 },
    camY: first.y - 900,
    hops: 0,
    score: 0,
    streak: 0,
    slow: 0,
    time: 0,
    over: false,
  };
  extend(world);
  return world;
}

export function multiplier(world) { return 1 + world.streak; }

// Release the ship along the tangent of its current orbit.
export function release(world) {
  const s = world.ship;
  if (world.over || s.mode !== 'orbit') return false;
  s.vx = -Math.sin(s.angle) * s.dir * SHIP_SPEED;
  s.vy = Math.cos(s.angle) * s.dir * SHIP_SPEED;
  s.mode = 'fly';
  s.lastPi = s.pi;
  s.grace = true;
  s.nearThisHop = 0;
  return true;
}

function capture(world, p, events) {
  const s = world.ship;
  const dx = s.x - p.x;
  const dy = s.y - p.y;
  s.angle = Math.atan2(dy, dx);
  s.dir = dx * s.vy - dy * s.vx > 0 ? 1 : -1;
  s.orbitR = Math.hypot(dx, dy);
  s.mode = 'orbit';
  s.pi = p.i;
  if (p.i !== s.lastPi) {
    world.hops++;
    world.streak = s.nearThisHop > 0 ? Math.min(world.streak + 1, 5) : 0;
    const pts = 10 * multiplier(world);
    world.score += pts;
    events.push({ type: 'hop', pts, mult: multiplier(world), x: p.x, y: p.y });
  }
  s.nearThisHop = 0;
}

function die(world, events) {
  if (world.over) return;
  world.over = true;
  events.push({ type: 'over' });
}

export function scrollSpeed(world) { return Math.min(14 + world.hops * 1.2, 70); }

// Advance the simulation by dt seconds. Returns a list of events for the scene (sound, particles, score popups).
export function step(world, dt, running = true) {
  const events = [];
  if (world.over) return events;
  dt = Math.min(dt, 0.05);
  const ts = world.slow > 0 ? 0.5 : 1;
  if (world.slow > 0) world.slow = Math.max(0, world.slow - dt);
  const d = dt * ts;
  world.time += d;
  const s = world.ship;

  for (const m of world.mines) if (m.amp) m.x = m.ox + Math.sin(world.time * m.sp + m.ph) * m.amp;

  if (s.mode === 'orbit') {
    const p = world.planets.find((q) => q.i === s.pi);
    s.orbitR += (p.orbitR - s.orbitR) * Math.min(1, dt * 10);
    s.angle += p.w * s.dir * d;
    s.x = p.x + Math.cos(s.angle) * s.orbitR;
    s.y = p.y + Math.sin(s.angle) * s.orbitR;
    if (p.type === 'crumble' && running) {
      p.life -= d;
      if (p.life <= 0) {
        p.spent = true;
        events.push({ type: 'crumble', x: p.x, y: p.y });
        release(world);
      }
    }
  } else {
    s.x += s.vx * d;
    s.y += s.vy * d;
    for (const p of world.planets) {
      if (p.spent) continue;
      const dist = Math.hypot(s.x - p.x, s.y - p.y);
      if (p.i === s.lastPi && s.grace) {
        if (dist > p.ring + 4) s.grace = false;
        continue;
      }
      if (dist < p.ring) { capture(world, p, events); break; }
    }
    for (const m of world.mines) {
      const dist = Math.hypot(s.x - m.x, s.y - m.y);
      if (dist < m.r + SHIP_R) { events.push({ type: 'boom', x: m.x, y: m.y }); die(world, events); return events; }
      if (!m.grazed && dist < m.nearR) {
        m.grazed = true;
        s.nearThisHop++;
        const pts = 5 * multiplier(world);
        world.score += pts;
        events.push({ type: 'near', pts, x: m.x, y: m.y });
      }
    }
    for (const o of world.orbs) {
      if (!o.taken && Math.hypot(s.x - o.x, s.y - o.y) < o.r + SHIP_R + 8) {
        o.taken = true;
        world.score += 25;
        world.slow = SLOW_TIME;
        events.push({ type: 'orb', x: o.x, y: o.y });
      }
    }
  }

  // Camera climbs steadily and follows the ship's planet.
  if (running) {
    let c = world.camY - scrollSpeed(world) * dt;
    const target = world.planets.find((q) => q.i === s.pi).y - 880;
    if (target < c) c += (target - c) * Math.min(1, dt * 4);
    world.camY = c;
  }

  if (s.y > world.camY + H + 40 || s.x < -60 || s.x > W + 60) die(world, events);

  extend(world);
  world.planets = world.planets.filter((p) => p.y < world.camY + H + 400 || p.i === s.pi);
  world.mines = world.mines.filter((m) => m.y < world.camY + H + 200);
  world.orbs = world.orbs.filter((o) => o.y < world.camY + H + 200);
  return events;
}
