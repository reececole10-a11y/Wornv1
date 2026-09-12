// ---------------------------------------------------------------------------
// audio.js - synthesised sound. Shots are short pitched blips, hits are
// filtered noise, and the level-up is a little arpeggio. No files.
// ---------------------------------------------------------------------------

export class Sound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.noise = null;
    this.master = null;
    this.lastShot = 0;
  }

  start() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  ready() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

  blip(freq, len = 0.1, gain = 0.12, type = 'square', slide = 1, at = 0) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + len);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }

  burst(freq, q, len, gain, type = 'bandpass') {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f).connect(env).connect(this.master);
    src.start(t);
    src.stop(t + len + 0.02);
  }

  // Shots are frequent, so they are rate limited and quiet.
  shoot() {
    const now = performance.now();
    if (now - this.lastShot < 55) return;
    this.lastShot = now;
    this.blip(760 + Math.random() * 120, 0.055, 0.045, 'square', 0.5);
  }

  hit() { this.burst(2400, 1.2, 0.05, 0.06); }
  kill() { this.burst(900, 0.7, 0.16, 0.13, 'lowpass'); }
  boom() { this.burst(320, 0.5, 0.45, 0.3, 'lowpass'); }
  pickup() { this.blip(1180, 0.05, 0.05, 'triangle', 1.6); }
  hurt() { this.blip(160, 0.3, 0.2, 'sawtooth', 0.4); }
  nova() { this.blip(300, 0.25, 0.1, 'sine', 3); }

  levelUp() {
    [0, 0.09, 0.18, 0.30].forEach((at, i) => this.blip(520 * Math.pow(1.26, i), 0.16, 0.1, 'triangle', 1, at));
  }

  gameOver() {
    [0, 0.18, 0.36].forEach((at, i) => this.blip(420 / Math.pow(1.3, i), 0.4, 0.14, 'sawtooth', 0.7, at));
  }

  bossWarn() {
    this.blip(90, 0.7, 0.22, 'sawtooth', 1.4);
    this.burst(200, 0.4, 0.7, 0.16, 'lowpass');
  }
}
