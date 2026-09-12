// ---------------------------------------------------------------------------
// game.js - the simulation and the renderer for Swarm.
//
// You move, everything else is automatic: weapons pick their own targets, the
// swarm keeps coming, and every level-up is a choice about how you want to
// die less.
// ---------------------------------------------------------------------------

import { Particles, Popups, Shake, makeGlow } from './fx.js';
import { WEAPONS, PASSIVES } from './weapons.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// `from` is the second of the run the type starts appearing.
export const TYPES = {
  grunt:    { hp: 12,  speed: 58,  r: 12, dmg: 6,  xp: 1,  color: '#ff5c7a', shape: 'tri',  from: 0 },
  swarmer:  { hp: 7,   speed: 106, r: 8,  dmg: 4,  xp: 1,  color: '#ffb037', shape: 'dot',  from: 45, pack: 5 },
  brute:    { hp: 72,  speed: 40,  r: 21, dmg: 15, xp: 4,  color: '#a06bff', shape: 'sq',   from: 95 },
  spitter:  { hp: 28,  speed: 44,  r: 12, dmg: 9,  xp: 3,  color: '#4ee7c1', shape: 'hex',  from: 150, ranged: true },
  splitter: { hp: 48,  speed: 64,  r: 16, dmg: 9, xp: 3,  color: '#7ee0ff', shape: 'hex',  from: 215, splits: 3 },
  boss:     { hp: 620, speed: 48, r: 34, dmg: 24, xp: 45, color: '#ff3860', shape: 'star', from: 1e9 },
};

export class Game {
  constructor(canvas, input, sound, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.sound = sound;
    this.ui = ui;
    this.glow = makeGlow();
    this.fx = new Particles();
    this.popups = new Popups();
    this.shake = new Shake();
    this.resize();
    this.reset();
  }

  reset() {
    this.time = 0;
    this.kills = 0;
    this.over = false;
    this.paused = false;
    this.spawnTimer = 0;
    this.nextBoss = 120;
    this.enemies = [];
    this.bullets = [];
    this.hostileShots = [];
    this.gems = [];
    this.hearts = [];
    this.rings = [];
    this.zaps = [];
    this.grid = new Map();
    this.fx.items.length = 0;
    this.popups.items.length = 0;

    this.player = {
      x: 0, y: 0, vx: 0, vy: 0, r: 11,
      hp: 100, maxHp: 100, speed: 158, regen: 0, armour: 1,
      pickup: 78, invuln: 0, flash: 0,
      level: 1, xp: 0, xpNext: 5,
      dmgMul: 1, rateMul: 1,
    };
    this.weapons = [{ id: 'bolt', level: 1, timer: 0 }];
    this.taken = { bolt: 1 };
    this.cam = { x: 0, y: 0 };
    for (let i = 0; i < 5; i++) this.spawnEnemy('grunt');
  }

  get dmgMul() { return this.player.dmgMul; }
  get rateMul() { return this.player.rateMul; }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.zoom = clamp(Math.min(w, h) / 460, 0.55, 1.25);
    this.halfW = w / 2 / this.zoom;
    this.halfH = h / 2 / this.zoom;
  }

  /* ------------------------------------------------------------ the update */

  update(dt) {
    if (this.over || this.paused) return;
    this.time += dt;

    this.updatePlayer(dt);
    for (const w of this.weapons) WEAPONS[w.id].update(this, w, dt);
    this.buildGrid();
    this.updateBullets(dt);
    this.updateRings(dt);
    this.updateEnemies(dt);
    this.updateHostileShots(dt);
    this.updateGems(dt);
    this.spawn(dt);

    for (let i = this.zaps.length - 1; i >= 0; i--) {
      this.zaps[i].life -= dt;
      if (this.zaps[i].life <= 0) this.zaps.splice(i, 1);
    }
    this.fx.update(dt);
    this.popups.update(dt);
    this.shake.update(dt);

    // The camera trails slightly behind, which makes movement feel weighty.
    this.cam.x += (this.player.x - this.cam.x) * Math.min(1, dt * 7);
    this.cam.y += (this.player.y - this.cam.y) * Math.min(1, dt * 7);
  }

  updatePlayer(dt) {
    const p = this.player;
    const want = Math.hypot(this.input.dx, this.input.dy);
    const nx = want > 1 ? this.input.dx / want : this.input.dx;
    const ny = want > 1 ? this.input.dy / want : this.input.dy;
    const target = [nx * p.speed, ny * p.speed];
    const k = 1 - Math.exp(-14 * dt);
    p.vx += (target[0] - p.vx) * k;
    p.vy += (target[1] - p.vy) * k;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (p.regen) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);
    if (p.invuln > 0) p.invuln -= dt;
    if (p.flash > 0) p.flash -= dt;

    // A faint trail while moving.
    if (Math.hypot(p.vx, p.vy) > 40 && Math.random() < 0.5) {
      this.fx.spawn(p.x, p.y, 1, { speed: 12, life: 0.3, color: '#5ad9ff', size: 3, drag: 4 });
    }
  }

  buildGrid() {
    this.grid.clear();
    this.cell = 64;
    for (const e of this.enemies) {
      const key = ((e.x / this.cell) | 0) + ',' + ((e.y / this.cell) | 0);
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, (list = []));
      list.push(e);
    }
  }

  *enemiesNear(x, y, radius) {
    const c = this.cell || 64;
    const x0 = ((x - radius) / c) | 0, x1 = ((x + radius) / c) | 0;
    const y0 = ((y - radius) / c) | 0, y1 = ((y + radius) / c) | 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.grid.get(cx + ',' + cy);
        if (!list) continue;
        for (const e of list) if (!e.dead) yield e;
      }
    }
  }

  nearestEnemy(x, y, maxDist = 500, exclude = null) {
    let best = null, bestD = maxDist * maxDist;
    for (const e of this.enemies) {
      if (e.dead || (exclude && exclude.has(e))) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  spawnBullet(b) {
    b.hits = b.pierce ? new Set() : null;
    this.bullets.push(b);
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      if (b.life <= 0) { this.bullets.splice(i, 1); continue; }

      if (b.homing) {
        const t = this.nearestEnemy(b.x, b.y, 320);
        if (t) {
          const want = Math.atan2(t.y - b.y, t.x - b.x);
          const cur = Math.atan2(b.vy, b.vx);
          let diff = ((want - cur + Math.PI * 3) % TAU) - Math.PI;
          const a = cur + clamp(diff, -b.homing * dt, b.homing * dt);
          b.vx = Math.cos(a) * b.speed;
          b.vy = Math.sin(a) * b.speed;
          b.angle = a;
        }
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      for (const e of this.enemiesNear(b.x, b.y, b.r + 24)) {
        if (b.hits && b.hits.has(e)) continue;
        if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 > (e.r + b.r) ** 2) continue;
        this.damage(e, b.damage, { x: b.x, y: b.y, color: b.color });
        if (b.hits && b.hits.size < b.pierce) { b.hits.add(e); }
        else { this.bullets.splice(i, 1); break; }
      }
    }
  }

  updateRings(dt) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const t = 1 - r.life / r.maxLife;
      r.r = 10 + (r.max - 10) * (1 - (1 - t) ** 2);
      for (const e of this.enemiesNear(r.x, r.y, r.r + 20)) {
        if (r.hit.has(e)) continue;
        const d = Math.hypot(e.x - r.x, e.y - r.y);
        if (d > r.r + e.r) continue;
        r.hit.add(e);
        this.damage(e, r.damage, { x: e.x, y: e.y, color: r.color });
        const a = Math.atan2(e.y - r.y, e.x - r.x);
        e.kx += Math.cos(a) * r.knock;
        e.ky += Math.sin(a) * r.knock;
      }
      if (r.life <= 0) this.rings.splice(i, 1);
    }
  }

  updateEnemies(dt) {
    const p = this.player;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) { this.enemies.splice(i, 1); continue; }
      if (e.flash > 0) e.flash -= dt;

      const dx = p.x - e.x, dy = p.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;

      if (e.type.ranged) {
        // Spitters hold their distance and fire.
        const want = dist < 150 ? -1 : dist > 260 ? 1 : 0;
        e.x += (dx / dist) * e.speed * want * dt;
        e.y += (dy / dist) * e.speed * want * dt;
        e.shotTimer -= dt;
        if (e.shotTimer <= 0 && dist < 380) {
          e.shotTimer = 2.4;
          this.hostileShots.push({ x: e.x, y: e.y, vx: (dx / dist) * 150, vy: (dy / dist) * 150, r: 6, damage: e.dmg, life: 4, color: e.type.color });
        }
      } else {
        e.x += (dx / dist) * e.speed * dt;
        e.y += (dy / dist) * e.speed * dt;
      }

      // Knockback, and a gentle shove so they do not stack into one dot.
      e.x += e.kx * dt; e.y += e.ky * dt;
      const damp = Math.exp(-9 * dt);
      e.kx *= damp; e.ky *= damp;
      for (const o of this.enemiesNear(e.x, e.y, e.r + 14)) {
        if (o === e) continue;
        const ox = e.x - o.x, oy = e.y - o.y;
        const d2 = ox * ox + oy * oy;
        const min = (e.r + o.r) * 0.85;
        if (d2 > min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) * 3.2 * dt;
        e.x += (ox / d) * push;
        e.y += (oy / d) * push;
      }

      // Touching the player hurts, with a short grace period afterwards.
      if (dist < e.r + p.r && p.invuln <= 0) this.hurtPlayer(e.dmg);
    }
  }

  updateHostileShots(dt) {
    const p = this.player;
    for (let i = this.hostileShots.length - 1; i >= 0; i--) {
      const s = this.hostileShots[i];
      s.life -= dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.life <= 0) { this.hostileShots.splice(i, 1); continue; }
      if ((s.x - p.x) ** 2 + (s.y - p.y) ** 2 < (s.r + p.r) ** 2) {
        this.hostileShots.splice(i, 1);
        if (p.invuln <= 0) this.hurtPlayer(s.damage);
      }
    }
  }

  updateGems(dt) {
    const p = this.player;
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i];
      const dx = p.x - h.x, dy = p.y - h.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < p.pickup * 0.8 || h.pulled) {
        h.pulled = true;
        h.x += (dx / d) * 190 * dt;
        h.y += (dy / d) * 190 * dt;
      }
      if (d < p.r + 12) {
        this.hearts.splice(i, 1);
        p.hp = Math.min(p.maxHp, p.hp + 22);
        this.popups.add(p.x, p.y - 20, '+22', '#8dff9b', 14);
        this.sound.pickup();
      }
    }
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i];
      g.age += dt;
      const dx = p.x - g.x, dy = p.y - g.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < p.pickup || g.pulled) {
        g.pulled = true;
        const pull = 60 + (p.pickup + 260 - d) * 2.2;
        g.x += (dx / d) * pull * dt;
        g.y += (dy / d) * pull * dt;
      } else if (g.age > 3) {
        // A slow drift home, so nothing you earned is ever really lost.
        const pull = Math.min(150, 40 + (g.age - 3) * 45);
        g.x += (dx / d) * pull * dt;
        g.y += (dy / d) * pull * dt;
      }
      if (d < p.r + 10) {
        this.gems.splice(i, 1);
        this.gainXp(g.value);
        this.sound.pickup();
        this.fx.spawn(g.x, g.y, 3, { speed: 60, life: 0.25, color: '#8dff9b', size: 2.5 });
      }
    }
  }

  /* -------------------------------------------------------------- spawning */

  spawn(dt) {
    // Boss waves punctuate the run every two minutes.
    if (this.time >= this.nextBoss) {
      this.nextBoss += 120;
      this.spawnEnemy('boss');
      this.sound.bossWarn();
      this.shake.add(10);
      this.ui.banner('A BIG ONE');
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const t = this.time;
    this.spawnTimer = clamp(1.0 - t / 240, 0.18, 1.0);

    const pool = Object.entries(TYPES).filter(([name, def]) => name !== 'boss' && t >= def.from);
    const [name, def] = pool[(Math.random() * pool.length) | 0];
    const batch = def.pack ? def.pack + Math.floor(t / 90) : 2 + Math.floor(t / 55);
    // Enough is enough: past this the frame rate matters more than the pressure.
    const room = Math.max(0, 340 - this.enemies.length);
    for (let i = 0; i < Math.min(batch, room); i++) this.spawnEnemy(name);
  }

  spawnEnemy(name, at = null) {
    const def = TYPES[name];
    const t = this.time;
    const hpMul = 1 + (t / 60) * 0.55;
    const speedMul = 1 + Math.min(0.4, t / 480);
    let x, y;
    if (at) { x = at[0]; y = at[1]; }
    else {
      const a = Math.random() * TAU;
      const dist = Math.max(this.halfW, this.halfH) + 70;
      x = this.player.x + Math.cos(a) * dist;
      y = this.player.y + Math.sin(a) * dist;
    }
    this.enemies.push({
      type: def, name,
      x, y, kx: 0, ky: 0,
      r: def.r, speed: def.speed * speedMul,
      hp: def.hp * hpMul, maxHp: def.hp * hpMul,
      dmg: def.dmg, flash: 0, cd: {}, shotTimer: 1.5,
      spin: Math.random() * TAU, dead: false,
    });
  }

  /* ------------------------------------------------------- damage and death */

  damage(e, amount, from = {}) {
    if (e.dead) return;
    e.hp -= amount;
    e.flash = 0.08;
    this.popups.add(e.x, e.y - e.r, Math.round(amount), from.color || '#fff', e.name === 'boss' ? 15 : 12);
    this.fx.spawn(from.x ?? e.x, from.y ?? e.y, 3, {
      speed: 130, life: 0.25, color: from.color || '#fff', size: 3,
      angle: Math.atan2(e.y - (from.y ?? e.y), e.x - (from.x ?? e.x)), spread: 1.6,
    });
    this.sound.hit();
    if (e.hp <= 0) this.kill(e);
  }

  kill(e) {
    e.dead = true;
    this.kills++;
    this.sound.kill();
    this.fx.spawn(e.x, e.y, e.name === 'boss' ? 46 : 10, {
      speed: e.name === 'boss' ? 260 : 150, life: 0.55, color: e.type.color, size: e.name === 'boss' ? 6 : 3.5,
    });
    if (e.name === 'boss') { this.shake.add(12); this.sound.boom(); this.ui.banner('DOWN'); }

    // Splitters burst into a small pack.
    if (e.type.splits) {
      for (let i = 0; i < e.type.splits; i++) {
        const a = (i / e.type.splits) * TAU;
        this.spawnEnemy('swarmer', [e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 18]);
      }
    }

    if (e.name === 'boss') {
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * TAU;
        this.hearts.push({ x: e.x + Math.cos(a) * 30, y: e.y + Math.sin(a) * 30, pulled: false });
      }
    } else if (Math.random() < 0.028) {
      this.hearts.push({ x: e.x, y: e.y, pulled: false });
    }

    const value = e.type.xp;
    const drops = e.name === 'boss' ? 9 : 1;
    for (let i = 0; i < drops; i++) {
      const a = Math.random() * TAU, d = drops > 1 ? 10 + Math.random() * 40 : 0;
      this.gems.push({ x: e.x + Math.cos(a) * d, y: e.y + Math.sin(a) * d, value, pulled: false, age: 0 });
    }
  }

  hurtPlayer(amount) {
    const p = this.player;
    const dealt = Math.max(1, amount * p.armour);
    p.hp -= dealt;
    p.invuln = 0.78;
    p.flash = 0.25;
    this.shake.add(5);
    this.sound.hurt();
    this.popups.add(p.x, p.y - 18, '-' + Math.round(dealt), '#ff6b6b', 14);
    this.fx.spawn(p.x, p.y, 10, { speed: 160, life: 0.35, color: '#ff6b6b', size: 3 });
    if (p.hp <= 0) {
      p.hp = 0;
      this.over = true;
      this.sound.gameOver();
      this.ui.gameOver(this);
    }
  }

  gainXp(n) {
    const p = this.player;
    p.xp += n;
    while (p.xp >= p.xpNext) {
      p.xp -= p.xpNext;
      p.level++;
      p.xpNext = Math.floor(4 + p.level * 2.6 + p.level * p.level * 0.22);
      this.levelUp();
    }
  }

  levelUp() {
    this.sound.levelUp();
    this.fx.spawn(this.player.x, this.player.y, 26, { speed: 200, life: 0.6, color: '#8dff9b', size: 4 });
    this.paused = true;
    this.ui.offer(this, this.choices());
  }

  // Three picks: new weapons, weapon upgrades, or passive boosts.
  choices() {
    const owned = this.weapons.length;
    const options = [];
    for (const [id, w] of Object.entries(WEAPONS)) {
      const level = this.taken[id] || 0;
      if (level === 0 && owned >= 5) continue;
      if (level >= w.max) continue;
      options.push({
        kind: level === 0 ? 'new' : 'weapon', id,
        name: w.name, color: w.color,
        text: level === 0 ? w.blurb : w.level(level + 1),
        level: level + 1,
        weight: level === 0 ? 2.2 : 3,
      });
    }
    for (const [id, p] of Object.entries(PASSIVES)) {
      const level = this.taken[id] || 0;
      if (level >= p.max) continue;
      options.push({ kind: 'passive', id, name: p.name, color: '#9fb4c7', text: p.blurb, level: level + 1, weight: 2 });
    }
    // Weighted pick without replacement.
    const picks = [];
    while (picks.length < 3 && options.length) {
      let total = options.reduce((s, o) => s + o.weight, 0);
      let roll = Math.random() * total;
      let index = 0;
      for (let i = 0; i < options.length; i++) {
        roll -= options[i].weight;
        if (roll <= 0) { index = i; break; }
      }
      picks.push(options.splice(index, 1)[0]);
    }
    if (!picks.length) picks.push({ kind: 'heal', id: 'heal', name: 'Patch up', color: '#8dff9b', text: 'Restore 40 health', level: 1, weight: 1 });
    return picks;
  }

  take(choice) {
    const p = this.player;
    this.taken[choice.id] = (this.taken[choice.id] || 0) + 1;
    if (choice.kind === 'passive') PASSIVES[choice.id].apply(p);
    else if (choice.kind === 'heal') p.hp = Math.min(p.maxHp, p.hp + 40);
    else {
      const existing = this.weapons.find((w) => w.id === choice.id);
      if (existing) existing.level++;
      else this.weapons.push({ id: choice.id, level: 1, timer: 0 });
    }
    this.paused = false;
  }

  /* ---------------------------------------------------------------- drawing */

  draw() {
    const ctx = this.ctx;
    const [sx, sy] = this.shake.offset();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#080b14';
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.save();
    ctx.translate(this.w / 2 + sx, this.h / 2 + sy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);

    this.drawFloor(ctx);
    this.drawGems(ctx);
    this.drawRings(ctx);
    this.drawEnemies(ctx);
    this.drawShots(ctx);
    this.drawPlayer(ctx);
    for (const w of this.weapons) if (WEAPONS[w.id].draw) WEAPONS[w.id].draw(this, w, ctx);
    this.drawZaps(ctx);
    this.fx.draw(ctx);
    this.popups.draw(ctx);

    ctx.restore();
  }

  drawFloor(ctx) {
    const step = 64;
    const x0 = Math.floor((this.cam.x - this.halfW) / step) * step;
    const x1 = this.cam.x + this.halfW;
    const y0 = Math.floor((this.cam.y - this.halfH) / step) * step;
    const y1 = this.cam.y + this.halfH;
    ctx.strokeStyle = 'rgba(90, 140, 200, 0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = y0; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    // Sparse specks, so movement reads even on an empty screen.
    ctx.fillStyle = 'rgba(120, 170, 230, 0.16)';
    for (let x = x0; x <= x1; x += step) {
      for (let y = y0; y <= y1; y += step) {
        const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        if (h % 11 === 0) ctx.fillRect(x + (h % 40), y + ((h >> 8) % 40), 2, 2);
      }
    }
  }

  glowAt(ctx, x, y, size, color, alpha = 1) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(x, y);
    ctx.drawImage(this.tint(color), -size / 2, -size / 2, size, size);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Glow sprites are cached per colour; there are only a handful.
  tint(color) {
    this.tints = this.tints || new Map();
    let c = this.tints.get(color);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = this.glow.width;
      const g = c.getContext('2d');
      g.drawImage(this.glow, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color;
      g.fillRect(0, 0, c.width, c.height);
      this.tints.set(color, c);
    }
    return c;
  }

  shape(ctx, kind, x, y, r, angle, outline = false) {
    ctx.beginPath();
    switch (kind) {
      case 'dot':
        ctx.arc(x, y, r, 0, TAU);
        break;
      case 'sq':
        ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
        ctx.rect(-r, -r, r * 2, r * 2); ctx.restore();
        break;
      case 'tri':
        for (let i = 0; i < 3; i++) {
          const a = angle + (i / 3) * TAU - Math.PI / 2;
          const px = x + Math.cos(a) * r * 1.25, py = y + Math.sin(a) * r * 1.25;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        break;
      case 'hex':
        for (let i = 0; i < 6; i++) {
          const a = angle + (i / 6) * TAU;
          const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        break;
      case 'star':
        for (let i = 0; i < 10; i++) {
          const a = angle + (i / 10) * TAU;
          const rr = i % 2 ? r * 0.55 : r;
          const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        break;
    }
    ctx.fill();
    if (outline) ctx.stroke();
  }

  drawEnemies(ctx) {
    for (const e of this.enemies) {
      if (Math.abs(e.x - this.cam.x) > this.halfW + 60 || Math.abs(e.y - this.cam.y) > this.halfH + 60) continue;
      e.spin += 0.02;
      this.glowAt(ctx, e.x, e.y, e.r * 7, e.type.color, 0.8);
      ctx.fillStyle = e.flash > 0 ? '#fff' : e.type.color;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      this.shape(ctx, e.type.shape, e.x, e.y, e.r, e.spin, true);
      if (e.name === 'boss' || e.hp < e.maxHp) {
        const w = e.r * 2.2, frac = clamp(e.hp / e.maxHp, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(e.x - w / 2, e.y - e.r - 9, w, 3.5);
        ctx.fillStyle = '#ff6b81';
        ctx.fillRect(e.x - w / 2, e.y - e.r - 9, w * frac, 3.5);
      }
    }
  }

  drawShots(ctx) {
    for (const b of this.bullets) {
      this.glowAt(ctx, b.x, b.y, b.r * 11, b.color, 0.9);
      ctx.fillStyle = '#fff';
      if (b.long) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle ?? Math.atan2(b.vy, b.vx));
        ctx.fillStyle = b.color;
        ctx.fillRect(-16, -b.r / 2, 32, b.r);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, TAU);
        ctx.fill();
      }
    }
    for (const s of this.hostileShots) {
      this.glowAt(ctx, s.x, s.y, s.r * 10, s.color, 0.8);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
  }

  drawRings(ctx) {
    for (const r of this.rings) {
      const alpha = clamp(r.life / r.maxLife, 0, 1);
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = alpha * 0.9;
      ctx.lineWidth = 6 * alpha + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawZaps(ctx) {
    ctx.lineCap = 'round';
    for (const z of this.zaps) {
      ctx.globalAlpha = clamp(z.life / 0.16, 0, 1);
      ctx.strokeStyle = z.color;
      ctx.lineWidth = 5;
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      // A couple of kinks make it read as lightning rather than a line.
      const mx = (z.x1 + z.x2) / 2 + (Math.random() - 0.5) * 26;
      const my = (z.y1 + z.y2) / 2 + (Math.random() - 0.5) * 26;
      ctx.moveTo(z.x1, z.y1);
      ctx.quadraticCurveTo(mx, my, z.x2, z.y2);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  drawGems(ctx) {
    for (const h of this.hearts) {
      this.glowAt(ctx, h.x, h.y, 40, '#ff7f96', 0.6);
      ctx.fillStyle = '#ff7f96';
      ctx.fillRect(h.x - 3, h.y - 9, 6, 18);
      ctx.fillRect(h.x - 9, h.y - 3, 18, 6);
    }
    for (const g of this.gems) {
      if (Math.abs(g.x - this.cam.x) > this.halfW + 40 || Math.abs(g.y - this.cam.y) > this.halfH + 40) continue;
      this.glowAt(ctx, g.x, g.y, 34, '#8dff9b', 0.75);
      ctx.fillStyle = '#8dff9b';
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(this.time * 2);
      ctx.fillRect(-3.5, -3.5, 7, 7);
      ctx.restore();
    }
  }

  drawPlayer(ctx) {
    const p = this.player;
    this.glowAt(ctx, p.x, p.y, 120, p.flash > 0 ? '#ff6b6b' : '#63d9ff', 0.95);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.vy, p.vx) + Math.PI / 2);
    ctx.fillStyle = p.flash > 0 ? '#ffd7d7' : '#eafcff';
    ctx.beginPath();
    ctx.moveTo(0, -16); ctx.lineTo(10, 11); ctx.lineTo(0, 5); ctx.lineTo(-10, 11);
    ctx.closePath();
    ctx.fill();
    // A dark rim, so you can still find yourself inside a wall of glow.
    ctx.strokeStyle = 'rgba(6,10,20,0.9)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
    if (p.invuln > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 20, 0, TAU);
      ctx.stroke();
    }
    // Pickup radius, very faint.
    ctx.strokeStyle = 'rgba(141,255,155,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.pickup, 0, TAU);
    ctx.stroke();
  }
}
