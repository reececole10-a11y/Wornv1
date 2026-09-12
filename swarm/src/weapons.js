// ---------------------------------------------------------------------------
// weapons.js - six auto-firing weapons. You never aim: the fun is in choosing
// what to level up and where to stand.
// ---------------------------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;

export const WEAPONS = {
  bolt: {
    name: 'Bolt',
    blurb: 'Fires at the nearest thing trying to eat you.',
    color: '#63d9ff',
    max: 6,
    level: (l) => `+${l > 1 ? 1 : 0} shot, more damage`,
    stats: (l) => ({ cooldown: lerp(0.52, 0.2, (l - 1) / 5), damage: 9 + l * 4, count: 1 + Math.floor(l / 2), speed: 430, pierce: l >= 5 ? 1 : 0 }),
    update(g, w, dt) {
      const s = this.stats(w.level);
      w.timer -= dt * g.rateMul;
      if (w.timer > 0) return;
      const target = g.nearestEnemy(g.player.x, g.player.y, 460);
      if (!target) return;
      w.timer = s.cooldown;
      const base = Math.atan2(target.y - g.player.y, target.x - g.player.x);
      for (let i = 0; i < s.count; i++) {
        const spread = (i - (s.count - 1) / 2) * 0.16;
        g.spawnBullet({
          x: g.player.x, y: g.player.y,
          vx: Math.cos(base + spread) * s.speed, vy: Math.sin(base + spread) * s.speed,
          r: 5, damage: s.damage * g.dmgMul, pierce: s.pierce, life: 1.3, color: this.color,
        });
      }
      g.sound.shoot();
    },
  },

  orbit: {
    name: 'Shards',
    blurb: 'Crystals circle you and cut whatever touches them.',
    color: '#c58bff',
    max: 6,
    level: (l) => (l % 2 ? 'more damage' : '+1 shard'),
    stats: (l) => ({ count: 2 + Math.floor(l / 2), damage: 7 + l * 3, radius: 62 + l * 4, spin: 2.6 }),
    update(g, w, dt) {
      const s = this.stats(w.level);
      w.angle = (w.angle || 0) + s.spin * dt;
      w.points = [];
      for (let i = 0; i < s.count; i++) {
        const a = w.angle + (i / s.count) * Math.PI * 2;
        const x = g.player.x + Math.cos(a) * s.radius;
        const y = g.player.y + Math.sin(a) * s.radius;
        w.points.push([x, y]);
        for (const e of g.enemiesNear(x, y, 40)) {
          const d = Math.hypot(e.x - x, e.y - y);
          if (d > e.r + 9) continue;
          if ((e.cd.orbit || 0) > g.time) continue;
          e.cd.orbit = g.time + 0.35;
          g.damage(e, s.damage * g.dmgMul, { x, y, color: this.color });
        }
      }
    },
    draw(g, w, ctx) {
      if (!w.points) return;
      ctx.fillStyle = this.color;
      for (const [x, y] of w.points) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(w.angle * 2);
        ctx.fillRect(-5, -5, 10, 10);
        ctx.restore();
      }
    },
  },

  nova: {
    name: 'Pulse',
    blurb: 'A shockwave rolls out from you and knocks the swarm back.',
    color: '#ffd166',
    max: 6,
    level: () => 'wider, harder, more often',
    stats: (l) => ({ cooldown: lerp(3.4, 1.5, (l - 1) / 5), damage: 14 + l * 7, radius: 110 + l * 22, knock: 190 }),
    update(g, w, dt) {
      const s = this.stats(w.level);
      w.timer -= dt * g.rateMul;
      if (w.timer > 0) return;
      w.timer = s.cooldown;
      g.rings.push({ x: g.player.x, y: g.player.y, r: 10, max: s.radius, life: 0.42, maxLife: 0.42,
                     damage: s.damage * g.dmgMul, knock: s.knock, color: this.color, hit: new Set() });
      g.sound.nova();
      g.shake.add(3);
    },
  },

  chain: {
    name: 'Arc',
    blurb: 'Lightning that jumps from body to body.',
    color: '#8dff9b',
    max: 6,
    level: (l) => '+1 jump, more damage',
    stats: (l) => ({ cooldown: lerp(1.5, 0.7, (l - 1) / 5), damage: 11 + l * 5, jumps: 2 + l, range: 190 }),
    update(g, w, dt) {
      const s = this.stats(w.level);
      w.timer -= dt * g.rateMul;
      if (w.timer > 0) return;
      let from = g.nearestEnemy(g.player.x, g.player.y, s.range);
      if (!from) return;
      w.timer = s.cooldown;
      const seen = new Set();
      let prev = { x: g.player.x, y: g.player.y };
      for (let i = 0; i < s.jumps && from; i++) {
        seen.add(from);
        g.zaps.push({ x1: prev.x, y1: prev.y, x2: from.x, y2: from.y, life: 0.16, color: this.color });
        g.damage(from, s.damage * g.dmgMul * (1 - i * 0.08), { x: from.x, y: from.y, color: this.color });
        prev = { x: from.x, y: from.y };
        from = g.nearestEnemy(prev.x, prev.y, 150, seen);
      }
      g.sound.hit();
    },
  },

  lance: {
    name: 'Lance',
    blurb: 'A heavy spear that runs straight through a whole line of them.',
    color: '#ff7a6b',
    max: 6,
    level: (l) => 'more damage and reach',
    stats: (l) => ({ cooldown: lerp(1.9, 1.0, (l - 1) / 5), damage: 26 + l * 12, pierce: 3 + l, speed: 560 }),
    update(g, w, dt) {
      const s = this.stats(w.level);
      w.timer -= dt * g.rateMul;
      if (w.timer > 0) return;
      const p = g.player;
      let a;
      if (Math.hypot(p.vx, p.vy) > 12) a = Math.atan2(p.vy, p.vx);
      else {
        const t = g.nearestEnemy(p.x, p.y, 520);
        if (!t) return;
        a = Math.atan2(t.y - p.y, t.x - p.x);
      }
      w.timer = s.cooldown;
      g.spawnBullet({
        x: p.x, y: p.y, vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed,
        r: 9, damage: s.damage * g.dmgMul, pierce: s.pierce, life: 1.1, color: this.color,
        long: true, angle: a,
      });
      g.sound.shoot();
      g.shake.add(1.5);
    },
  },

  drones: {
    name: 'Motes',
    blurb: 'Little sparks that hunt on their own.',
    color: '#ffa8f0',
    max: 6,
    level: (l) => 'faster, fiercer swarm',
    stats: (l) => ({ cooldown: lerp(0.9, 0.3, (l - 1) / 5), damage: 7 + l * 3, speed: 250, turn: 5 }),
    update(g, w, dt) {
      const s = this.stats(w.level);
      w.timer -= dt * g.rateMul;
      if (w.timer > 0) return;
      w.timer = s.cooldown;
      const a = Math.random() * Math.PI * 2;
      g.spawnBullet({
        x: g.player.x, y: g.player.y, vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed,
        r: 5, damage: s.damage * g.dmgMul, pierce: 0, life: 2.4, color: this.color,
        homing: s.turn, speed: s.speed,
      });
    },
  },
};

export const PASSIVES = {
  power:  { name: 'Power',   blurb: '+15% damage',        max: 5, apply: (p) => { p.dmgMul *= 1.15; } },
  haste:  { name: 'Haste',   blurb: '+12% fire rate',     max: 5, apply: (p) => { p.rateMul *= 1.12; } },
  swift:  { name: 'Swift',   blurb: '+10% move speed',    max: 5, apply: (p) => { p.speed *= 1.1; } },
  vigor:  { name: 'Vigor',   blurb: '+25 max health',     max: 5, apply: (p) => { p.maxHp += 25; p.hp += 25; } },
  magnet: { name: 'Magnet',  blurb: '+40% pickup range',  max: 4, apply: (p) => { p.pickup *= 1.4; } },
  regen:  { name: 'Regen',   blurb: '+0.6 health/second', max: 4, apply: (p) => { p.regen += 0.6; } },
  armour: { name: 'Armour',  blurb: '-15% damage taken',  max: 4, apply: (p) => { p.armour *= 0.85; } },
};
