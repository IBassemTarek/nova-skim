// Tiny WebAudio synth: no audio files shipped.
let ctx = null;
let enabled = true;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function tone(freq, dur, type = 'sine', gain = 0.12, delay = 0) {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const audio = {
  unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); },
  setEnabled(v) { enabled = v; },
  suspend() { ctx?.suspend(); },
  resume() { ctx?.resume(); },
  release() { tone(220, 0.12, 'sawtooth', 0.05); tone(440, 0.1, 'triangle', 0.05, 0.03); },
  // Each hop plays the next note of a pentatonic scale, so a good run sounds like a melody.
  hop(n, streak = 0) {
    const scale = [0, 2, 4, 7, 9];
    const semis = scale[n % 5] + 12 * (Math.floor(n / 5) % 3);
    const f = 261.6 * Math.pow(2, semis / 12);
    tone(f, 0.22, 'triangle', 0.13);
    tone(f * 2, 0.3, 'sine', 0.05, 0.04);
    if (streak > 0) tone(f * 1.5, 0.2, 'sine', 0.06 + streak * 0.01, 0.08);
  },
  near(streak = 0) { tone(880 * Math.pow(1.06, streak), 0.09, 'square', 0.04); },
  orb() { [660, 880, 1320].forEach((f, i) => tone(f, 0.14, 'sine', 0.08, i * 0.05)); },
  crumble() { tone(140, 0.2, 'sawtooth', 0.06); },
  over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.28, 'sawtooth', 0.08, i * 0.16)); },
  best() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.1, i * 0.09)); },
};

export default audio;
