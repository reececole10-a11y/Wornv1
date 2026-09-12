// ---------------------------------------------------------------------------
// audio.js - every sound is synthesised on the fly with the Web Audio API.
// Filtered noise makes convincing digging and footsteps; short pitched blips
// cover placing blocks and taking damage. No audio files to ship.
// ---------------------------------------------------------------------------

import * as B from './blocks.js';

// Rough material groups, so stone sounds nothing like sand.
function material(id) {
  switch (id) {
    case B.STONE: case B.COBBLE: case B.STONE_BRICK: case B.BRICK: case B.BEDROCK:
    case B.COAL_ORE: case B.IRON_ORE: case B.GOLD_ORE: case B.GLOWSTONE:
      return { freq: 1500, q: 1.4, len: 0.16, gain: 0.5, tone: 210 };
    case B.LOG: case B.PLANKS: case B.LANTERN:
      return { freq: 780, q: 2.2, len: 0.14, gain: 0.5, tone: 320 };
    case B.SAND: case B.GRAVEL: case B.SANDSTONE:
      return { freq: 2600, q: 0.6, len: 0.2, gain: 0.38, tone: 180 };
    case B.GLASS:
      return { freq: 4200, q: 3, len: 0.12, gain: 0.35, tone: 900 };
    case B.LEAVES: case B.TALL_GRASS: case B.FLOWER_RED: case B.FLOWER_YEL: case B.CACTUS:
      return { freq: 3200, q: 0.8, len: 0.13, gain: 0.26, tone: 260 };
    case B.SNOW:
      return { freq: 3000, q: 0.7, len: 0.15, gain: 0.3, tone: 240 };
    default: // dirt, grass, wool
      return { freq: 900, q: 0.9, len: 0.16, gain: 0.42, tone: 150 };
  }
}

export class Sound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.noiseBuffer = null;
  }

  // Browsers only allow audio to start from a tap, so this is called from the
  // Play button.
  start() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      const len = this.ctx.sampleRate * 0.4;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  ready() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

  burst({ freq, q, len, gain, type = 'bandpass', at = 0 }) {
    if (!this.ready()) return;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq * (0.9 + Math.random() * 0.2);
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(filter).connect(env).connect(ctx.destination);
    src.start(t);
    src.stop(t + len + 0.02);
  }

  blip({ freq, len = 0.12, gain = 0.16, type = 'triangle', slide = 1 }) {
    if (!this.ready()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + len);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(env).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }

  hit(id) {
    const m = material(id);
    this.burst({ freq: m.freq, q: m.q, len: m.len * 0.5, gain: m.gain * 0.3 });
  }

  dig(id) {
    const m = material(id);
    this.burst({ freq: m.freq, q: m.q, len: m.len, gain: m.gain });
    this.blip({ freq: m.tone, len: 0.1, gain: 0.08, slide: 0.6 });
  }

  place(id) {
    const m = material(id);
    this.burst({ freq: m.freq * 0.8, q: m.q, len: 0.09, gain: m.gain * 0.7 });
    this.blip({ freq: m.tone * 1.2, len: 0.07, gain: 0.07, slide: 0.7 });
  }

  step(id) {
    const m = material(id);
    this.burst({ freq: m.freq * 0.7, q: 0.7, len: 0.07, gain: m.gain * 0.22 });
  }

  splash() {
    this.burst({ freq: 1800, q: 0.4, len: 0.3, gain: 0.3, type: 'lowpass' });
  }

  hurt() {
    this.blip({ freq: 180, len: 0.28, gain: 0.22, type: 'sawtooth', slide: 0.45 });
  }

  pop() {
    this.blip({ freq: 620, len: 0.06, gain: 0.1, slide: 1.6 });
  }
}
