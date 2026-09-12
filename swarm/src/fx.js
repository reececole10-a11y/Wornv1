// ---------------------------------------------------------------------------
// fx.js - particles, floating numbers, screen shake and the glow sprite that
// gives everything its neon edge. All pooled: nothing allocates mid-fight.
// ---------------------------------------------------------------------------

export function makeGlow(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export class Particles {
  constructor(max = 900) {
    this.items = [];
    this.max = max;
  }

  spawn(x, y, count, opts = {}) {
    const {
      speed = 90, spread = Math.PI * 2, angle = 0, life = 0.5,
      color = '#fff', size = 3, drag = 3, gravity = 0,
    } = opts;
    for (let i = 0; i < count; i++) {
      if (this.items.length >= this.max) this.items.shift();
      const a = angle + (Math.random() - 0.5) * spread;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.items.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life * (0.6 + Math.random() * 0.7), max: life, color,
        size: size * (0.6 + Math.random() * 0.8), drag, gravity,
      });
    }
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      if (p.life <= 0) { this.items.splice(i, 1); continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx) {
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.items) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.fillStyle = p.color;
      const s = p.size;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

export class Popups {
  constructor(max = 40) { this.items = []; this.max = max; }

  add(x, y, text, color = '#fff', size = 13) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ x: x + (Math.random() - 0.5) * 10, y, text, color, size, life: 0.65, vy: -46 });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      p.y += p.vy * dt;
      p.vy *= Math.exp(-2.5 * dt);
      if (p.life <= 0) this.items.splice(i, 1);
    }
  }

  draw(ctx) {
    ctx.textAlign = 'center';
    for (const p of this.items) {
      ctx.globalAlpha = Math.min(1, p.life * 2.4);
      ctx.font = `700 ${p.size}px ui-rounded, Avenir Next, system-ui, sans-serif`;
      ctx.fillStyle = '#000';
      ctx.fillText(p.text, p.x + 1, p.y + 1);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }
}

export class Shake {
  constructor() { this.amount = 0; }
  add(v) { this.amount = Math.min(18, this.amount + v); }
  update(dt) { this.amount *= Math.exp(-7 * dt); }
  offset() {
    if (this.amount < 0.05) return [0, 0];
    return [(Math.random() - 0.5) * this.amount, (Math.random() - 0.5) * this.amount];
  }
}
