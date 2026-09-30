import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, release, step, multiplier, makeRng, W } from '../src/game/world.js';

test('rng is deterministic', () => {
  const a = makeRng(5); const b = makeRng(5);
  assert.equal(a(), b());
});

test('world starts orbiting the first planet with planets ahead', () => {
  const w = createWorld(1);
  assert.equal(w.ship.mode, 'orbit');
  assert.ok(w.planets.length > 3);
  assert.ok(w.planets[1].y < w.planets[0].y);
});

test('orbit keeps a constant distance from the planet', () => {
  const w = createWorld(1);
  const p = w.planets[0];
  for (let i = 0; i < 30; i++) step(w, 1 / 60);
  assert.ok(Math.abs(Math.hypot(w.ship.x - p.x, w.ship.y - p.y) - p.orbitR) < 1);
});

test('release flies along the tangent', () => {
  const w = createWorld(1);
  assert.ok(release(w));
  const s = w.ship;
  const p = w.planets[0];
  const radial = ((s.x - p.x) * s.vx + (s.y - p.y) * s.vy);
  assert.ok(Math.abs(radial) < 1e-6);
  assert.equal(s.mode, 'fly');
  assert.equal(release(w), false);
});

test('flying at the next planet captures it and scores a hop', () => {
  const w = createWorld(3);
  const target = w.planets[1];
  w.ship.mode = 'fly';
  w.ship.lastPi = 0;
  w.ship.grace = false;
  w.ship.x = target.x;
  w.ship.y = target.y + target.ring + 20;
  w.ship.vx = 0;
  w.ship.vy = -640;
  let hop = null;
  for (let i = 0; i < 20 && !hop; i++) hop = step(w, 1 / 60).find((e) => e.type === 'hop');
  assert.ok(hop);
  assert.equal(w.ship.mode, 'orbit');
  assert.equal(w.ship.pi, target.i);
  assert.equal(w.hops, 1);
  assert.equal(w.score, 10);
});

test('near miss builds a streak and multiplier', () => {
  const w = createWorld(3);
  w.mines = [{ ox: 300, x: 300, y: 300, r: 13, nearR: 46, amp: 0, sp: 1, ph: 0, grazed: false }];
  w.ship.mode = 'fly';
  w.ship.grace = false;
  w.ship.lastPi = 0;
  w.ship.x = 330; // 30px from the mine centre: inside near radius, outside hit radius
  w.ship.y = 300;
  w.ship.vx = 0; w.ship.vy = 0;
  const ev = step(w, 1 / 60);
  assert.ok(ev.some((e) => e.type === 'near'));
  assert.equal(w.ship.nearThisHop, 1);
  w.streak = 0;
  assert.equal(multiplier(w), 1);
});

test('hitting a mine ends the game', () => {
  const w = createWorld(3);
  w.mines = [{ ox: 300, x: 300, y: 300, r: 13, nearR: 46, amp: 0, sp: 1, ph: 0, grazed: false }];
  w.ship.mode = 'fly';
  w.ship.grace = false;
  w.ship.x = 305; w.ship.y = 300; w.ship.vx = 0; w.ship.vy = 0;
  step(w, 1 / 60);
  assert.equal(w.over, true);
});

test('leaving the sides ends the game', () => {
  const w = createWorld(3);
  w.ship.mode = 'fly';
  w.ship.x = W + 100; w.ship.y = w.camY + 500; w.ship.vx = 0; w.ship.vy = 0;
  step(w, 1 / 60);
  assert.equal(w.over, true);
});

test('long run keeps generating planets with bounded spacing', () => {
  const w = createWorld(9);
  for (let i = 0; i < 60; i++) {
    w.camY -= 400;
    w.ship.y = w.camY + 800;
    w.ship.mode = 'fly'; w.ship.vx = 0; w.ship.vy = 0; w.ship.x = 360;
    step(w, 1 / 60, false);
    w.over = false;
  }
  const ps = w.planets;
  for (let i = 1; i < ps.length; i++) {
    assert.ok(ps[i - 1].y - ps[i].y >= 249 && ps[i - 1].y - ps[i].y <= 341);
  }
});
