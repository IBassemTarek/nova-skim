"""Synthesizes the preview video's soundtrack (all original, generated from math: no samples, no music rights issues).
Sound effects mirror the game's own WebAudio tones (src/audio.js); a soft arpeggio bed sits underneath.
Timed from the same script as make_video.py. Run via make_video.py, or: python3 store/make_audio.py
"""
import math
import struct
import wave
from pathlib import Path

RATE = 44100


def _wave(kind, phase):
    p = phase % 1.0
    if kind == 'sine':
        return math.sin(math.tau * p)
    if kind == 'triangle':
        return 4 * abs(p - 0.5) - 1
    if kind == 'sawtooth':
        return 2 * p - 1
    if kind == 'square':
        return 1.0 if p < 0.5 else -1.0
    raise ValueError(kind)


class Mixer:
    def __init__(self, seconds):
        self.n = int(seconds * RATE)
        self.buf = [0.0] * self.n

    def tone(self, freq, dur, kind='sine', gain=0.1, at=0.0, attack=0.01):
        """Same envelope as the game: quick rise, then exponential decay to silence."""
        start = int(at * RATE)
        count = int((dur + 0.02) * RATE)
        floor = 0.0001
        for i in range(count):
            j = start + i
            if j >= self.n:
                break
            t = i / RATE
            if t < attack:
                env = gain * (t / attack)
            else:
                env = gain * (floor / gain) ** (min((t - attack) / max(dur - attack, 1e-3), 1.0))
            self.buf[j] += env * _wave(kind, freq * t)

    def fade(self, fade_in, fade_out):
        for i in range(self.n):
            t = i / RATE
            g = min(1.0, t / fade_in) * min(1.0, (self.n / RATE - t) / fade_out)
            self.buf[i] *= g

    def write(self, path, peak=0.85):
        top = max(abs(x) for x in self.buf) or 1.0
        k = peak / top
        with wave.open(str(path), 'wb') as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(RATE)
            frames = bytearray()
            for x in self.buf:
                v = int(max(-1.0, min(1.0, x * k)) * 32767)
                frames += struct.pack('<hh', v, v)
            w.writeframes(bytes(frames))


CHORDS = [  # Am, F, C, G  (bass, triad)
    (110.00, [220.00, 261.63, 329.63]),
    (87.31, [174.61, 220.00, 261.63]),
    (130.81, [261.63, 329.63, 392.00]),
    (98.00, [196.00, 246.94, 293.66]),
]


def music(m, total):
    beat = 60 / 96
    eighth = beat / 2
    bar = beat * 4
    t, ci = 0.0, 0
    while t < total:
        bass, tri = CHORDS[ci % 4]
        m.tone(bass, bar * 0.9, 'sine', 0.05, t)
        pattern = [tri[0], tri[1], tri[2], tri[0] * 2, tri[2], tri[1], tri[0], tri[1]]
        for k, f in enumerate(pattern):
            m.tone(f, 0.42, 'triangle', 0.028, t + k * eighth)
        t += bar
        ci += 1


def build(path, total, frames, fps=30):
    """Soundtrack from the recorded run: the same tones as the game (src/audio.js) at each event's frame time."""
    m = Mixer(total)
    music(m, total)
    hops = 0
    for idx, fr in enumerate(frames):
        at = idx / fps
        for e in fr['events']:
            if e['type'] == 'release':
                m.tone(220, 0.12, 'sawtooth', 0.05, at)
                m.tone(440, 0.10, 'triangle', 0.05, at + 0.03)
            elif e['type'] == 'hop':
                semis = [0, 2, 4, 7, 9][hops % 5] + 12 * ((hops // 5) % 3)
                f = 261.6 * 2 ** (semis / 12)
                m.tone(f, 0.22, 'triangle', 0.13, at)
                m.tone(f * 2, 0.30, 'sine', 0.05, at + 0.04)
                streak = fr['streak']
                if streak > 0:
                    m.tone(f * 1.5, 0.20, 'sine', 0.06 + streak * 0.01, at + 0.08)
                hops += 1
            elif e['type'] == 'near':
                m.tone(880 * 1.06 ** fr['streak'], 0.09, 'square', 0.04, at)
            elif e['type'] == 'orb':
                for k, f in enumerate([660, 880, 1320]):
                    m.tone(f, 0.14, 'sine', 0.08, at + k * 0.05)
    m.fade(0.4, 1.2)
    m.write(path)
