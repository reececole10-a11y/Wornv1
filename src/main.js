// ---------------------------------------------------------------------------
// main.js - puts the pieces together: the frame loop, chunk streaming, the
// day/night sky, and everything the buttons are wired to.
// ---------------------------------------------------------------------------

import { World, CHUNK_X, CHUNK_Z, SECTIONS, chunkKey } from './world.js';
import { buildSectionMesh } from './mesher.js';
import { Renderer } from './renderer.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import * as B from './blocks.js';
import { clamp, lerp } from './math.js';
import { Sound } from './audio.js';
import { saveGame, loadGame, clearSave, saveSettings, loadSettings, restoreEdits } from './storage.js';

const DAY_LENGTH = 600;         // seconds for a full day/night cycle
const isPhone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const defaultSettings = {
  renderDistance: isPhone ? 5 : 8,
  sensitivity: 1,
  fov: 72,
  resolution: isPhone ? 0.85 : Math.min(1.25, window.devicePixelRatio || 1),
  creative: false,
  damage: true,
  autoJump: true,
  headlamp: true,
  sound: true,
  debug: false,
};

class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.settings = Object.assign({}, defaultSettings, loadSettings() || {});
    this.renderer = new Renderer(this.canvas);

    const save = loadGame();
    this.firstRun = !save;
    this.world = new World(save ? save.seed : (Math.random() * 2 ** 31) | 0);
    if (save) {
      restoreEdits(this.world, save.edits);
      this.world.time = save.time ?? 0.3;
    }

    const spawn = save
      ? [save.player.x, save.player.y, save.player.z]
      : this.world.spawnPoint(8, 8);
    this.player = new Player(this.world, spawn);
    if (save) this.restorePlayer(save.player);
    this.player.creative = this.settings.creative;
    this.player.damageEnabled = this.settings.damage;
    this.player.autoJump = this.settings.autoJump;

    this.input = new Input(this.canvas, this.settings);
    this.ui = new UI(this);
    this.sound = new Sound();
    this.sound.enabled = this.settings.sound;
    this.tintWater = document.getElementById('tint-water');
    this.tintHurt = document.getElementById('tint-hurt');

    this.meshed = new Set();
    this.target = null;
    this.breakProgress = 0;
    this.breakTarget = null;
    this.swing = 0;
    this.stepAccum = 0;
    this.hitClock = 0;
    this.wasInWater = false;
    this.lastHealth = this.player.health;
    this.frames = 0;
    this.fps = 0;
    this.fpsClock = performance.now();
    this.lastSave = performance.now();

    this.bindControls();
    this.syncSettingsUI();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    window.addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
  }

  restorePlayer(p) {
    const pl = this.player;
    pl.yaw = p.yaw ?? 0; pl.pitch = p.pitch ?? 0;
    pl.health = p.health ?? 10;
    pl.flying = !!p.flying;
    pl.hotbar = p.hotbar && p.hotbar.length === 9 ? p.hotbar : pl.hotbar;
    pl.slot = p.slot ?? 0;
    pl.spawn = p.spawn || [pl.x, pl.y, pl.z];
    pl.inventory = new Map(p.inventory || []);
  }

  /* --------------------------------------------------------------- controls */

  bindControls() {
    const input = this.input;

    input.bindButton(document.getElementById('btn-mine'),
      () => { input.mining = true; }, () => { input.mining = false; });
    input.bindButton(document.getElementById('btn-place'),
      () => { input.placeQueued = true; });

    // Jump, with a double tap for flight.
    let lastJump = 0;
    input.bindButton(document.getElementById('btn-jump'), () => {
      const now = performance.now();
      if (now - lastJump < 320) this.toggleFly();
      lastJump = now;
      input.buttonJump = true;
      input.syncKeys();
    }, () => { input.buttonJump = false; input.syncKeys(); });

    input.bindButton(document.getElementById('btn-up'),
      () => { input.buttonUp = true; input.syncKeys(); },
      () => { input.buttonUp = false; input.syncKeys(); });
    input.bindButton(document.getElementById('btn-down'),
      () => { input.buttonDown = true; input.syncKeys(); },
      () => { input.buttonDown = false; input.syncKeys(); });

    input.onFlyToggle = () => this.toggleFly();
    input.onInventory = () => this.ui.openInventory();
    input.onPause = () => this.ui.toggleMenu();
    input.onSlot = (index, delta) => {
      if (index !== null && index !== undefined) this.selectSlot(index);
      else this.selectSlot((this.player.slot + (delta > 0 ? 1 : 8)) % 9);
    };

    const bindRange = (id, key, format, after) => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => {
        this.settings[key] = parseFloat(el.value);
        document.getElementById(id + '-val').textContent = format(this.settings[key]);
        saveSettings(this.settings);
        if (after) after();
      });
    };
    bindRange('rd', 'renderDistance', (v) => v + ' chunks');
    bindRange('sens', 'sensitivity', (v) => v.toFixed(1) + 'x');
    bindRange('fov', 'fov', (v) => v + '°');
    bindRange('res', 'resolution', (v) => Math.round(v * 100) + '%', () => this.resize());

    const bindSwitch = (id, key, apply) => {
      const el = document.getElementById(id);
      el.addEventListener('change', () => {
        this.settings[key] = el.checked;
        saveSettings(this.settings);
        apply && apply(el.checked);
      });
    };
    bindSwitch('creative', 'creative', (v) => { this.player.creative = v; this.ui.refreshHotbar(); });
    bindSwitch('damage', 'damage', (v) => { this.player.damageEnabled = v; });
    bindSwitch('autojump', 'autoJump', (v) => { this.player.autoJump = v; });
    bindSwitch('headlamp', 'headlamp');
    bindSwitch('sound', 'sound', (v) => { this.sound.enabled = v; if (v) this.sound.start(); });
    bindSwitch('showdebug', 'debug', (v) => { document.getElementById('debug').hidden = !v; });

    document.getElementById('btn-fly').addEventListener('click', () => this.toggleFly());
    document.getElementById('btn-daynight').addEventListener('click', () => {
      this.world.time = this.world.time > 0.25 && this.world.time < 0.75 ? 0.0 : 0.5;
      this.toast(this.world.time === 0.5 ? 'Midday' : 'Midnight');
    });
    document.getElementById('btn-save').addEventListener('click', () => {
      this.toast(this.save() ? 'Saved' : 'Could not save');
    });
    document.getElementById('btn-new').addEventListener('click', () => {
      if (!confirm('Start a new world? Everything you have built here is lost.')) return;
      clearSave();
      location.reload();
    });
    document.getElementById('btn-play').addEventListener('click', () => {
      this.ui.el.boot.hidden = true;
      this.started = true;
      if (this.settings.sound) this.sound.start();
      if (this.firstRun) {
        setTimeout(() => this.toast('Hold the right of the screen to mine'), 1800);
        setTimeout(() => this.toast('Tap to place what you have mined'), 7000);
      }
    });
  }

  toggleFly() {
    const p = this.player;
    p.flying = !p.flying;
    p.vy = 0;
    document.getElementById('fly-pad').hidden = !p.flying;
    this.toast(p.flying ? 'Flying' : 'Walking');
  }

  selectSlot(i) {
    this.player.slot = clamp(i, 0, 8);
    this.ui.refreshHotbar();
  }

  respawn() {
    this.player.respawn();
    this.ui.showDeath(false);
  }

  toast(message) { this.ui.toast(message); }

  syncSettingsUI() {
    const s = this.settings;
    const set = (id, value, text) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = value;
      const label = document.getElementById(id + '-val');
      if (label) label.textContent = text;
    };
    set('rd', s.renderDistance, s.renderDistance + ' chunks');
    set('sens', s.sensitivity, s.sensitivity.toFixed(1) + 'x');
    set('fov', s.fov, s.fov + '°');
    set('res', s.resolution, Math.round(s.resolution * 100) + '%');
    document.getElementById('creative').checked = s.creative;
    document.getElementById('damage').checked = s.damage;
    document.getElementById('autojump').checked = s.autoJump;
    document.getElementById('headlamp').checked = s.headlamp;
    document.getElementById('sound').checked = s.sound;
    document.getElementById('showdebug').checked = s.debug;
    document.getElementById('debug').hidden = !s.debug;
    document.getElementById('seed-line').textContent = 'World seed: ' + this.world.seed;
  }

  save() {
    return saveGame(this.world, this.player);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const scale = clamp(this.settings.resolution * (isPhone ? dpr : 1), 0.4, 2.5);
    this.renderer.resize(window.innerWidth, window.innerHeight, scale);
  }

  /* -------------------------------------------------------- chunk streaming */

  // Generate and mesh as much as fits in the time budget, closest first.
  stream(budgetMs) {
    const t0 = performance.now();
    const world = this.world;
    const pcx = Math.floor(this.player.x / CHUNK_X);
    const pcz = Math.floor(this.player.z / CHUNK_Z);
    const R = this.settings.renderDistance;

    // 1. Missing chunks inside the radius.
    let wanted = null, wantedDist = Infinity;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = dx * dx + dz * dz;
        if (d > R * R) continue;
        if (world.chunks.has(chunkKey(pcx + dx, pcz + dz))) continue;
        if (d < wantedDist) { wantedDist = d; wanted = [pcx + dx, pcz + dz]; }
      }
    }
    while (wanted && performance.now() - t0 < budgetMs * 0.6) {
      world.generateChunk(wanted[0], wanted[1]);
      wanted = null; wantedDist = Infinity;
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          const d = dx * dx + dz * dz;
          if (d > R * R) continue;
          if (world.chunks.has(chunkKey(pcx + dx, pcz + dz))) continue;
          if (d < wantedDist) { wantedDist = d; wanted = [pcx + dx, pcz + dz]; }
        }
      }
    }

    // 2. Blocks that changed invalidate their section.
    for (const key of world.dirtySections) this.meshed.delete(key);
    world.dirtySections.clear();

    // 3. Mesh sections, nearest chunk first. A chunk needs its four
    //    neighbours present or the faces at the seam would be wrong.
    const todo = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = dx * dx + dz * dz;
        if (d > R * R) continue;
        const cx = pcx + dx, cz = pcz + dz;
        if (!world.chunks.has(chunkKey(cx, cz))) continue;
        if (!world.chunks.has(chunkKey(cx + 1, cz)) || !world.chunks.has(chunkKey(cx - 1, cz)) ||
            !world.chunks.has(chunkKey(cx, cz + 1)) || !world.chunks.has(chunkKey(cx, cz - 1))) continue;
        for (let sy = 0; sy < SECTIONS; sy++) {
          const key = cx + ',' + sy + ',' + cz;
          if (this.meshed.has(key)) continue;
          todo.push([d, key, cx, sy, cz]);
        }
      }
    }
    todo.sort((a, b) => a[0] - b[0]);
    for (const [, key, cx, sy, cz] of todo) {
      if (performance.now() - t0 > budgetMs) break;
      this.renderer.uploadSection(key, buildSectionMesh(world, cx, sy, cz));
      this.meshed.add(key);
    }

    // 4. Drop what is far behind us.
    const limit = R + 3;
    for (const key of [...world.chunks.keys()]) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.abs(cx - pcx) <= limit && Math.abs(cz - pcz) <= limit) continue;
      world.unloadChunk(cx, cz);
      this.renderer.dropChunk(cx, cz);
      for (let sy = 0; sy < SECTIONS; sy++) this.meshed.delete(cx + ',' + sy + ',' + cz);
    }
    return todo.length;
  }

  /* ---------------------------------------------------------------- the sky */

  skyState() {
    const t = this.world.time;
    const angle = (t - 0.25) * Math.PI * 2;
    const sunY = Math.sin(angle);
    const sunDir = [Math.cos(angle), sunY, 0.25];
    const len = Math.hypot(...sunDir);
    for (let i = 0; i < 3; i++) sunDir[i] /= len;

    const day = clamp(sunY * 1.7 + 0.42, 0, 1);       // 0 at night, 1 at noon
    const dusk = clamp(1 - Math.abs(sunY) * 3.2, 0, 1); // sunrise/sunset glow

    const mix = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
    const nightTop = [0.015, 0.025, 0.07], dayTop = [0.26, 0.50, 0.92];
    const nightHor = [0.05, 0.07, 0.14], dayHor = [0.68, 0.83, 0.97];
    const duskHor = [0.95, 0.52, 0.28];

    let top = mix(nightTop, dayTop, day);
    let horizon = mix(nightHor, dayHor, day);
    horizon = mix(horizon, duskHor, dusk * 0.75);
    const sunColor = sunY > -0.1 ? mix([1, 0.98, 0.9], [1, 0.6, 0.3], dusk) : [0.75, 0.8, 0.95];

    const sky = {
      top, horizon, fog: horizon.slice(),
      sunDir, sunColor,
      stars: clamp(-sunY * 2.2, 0, 1),
      daylight: clamp(0.2 + day * 0.85, 0.2, 1),
      cloudTint: [lerp(0.35, 1, day), lerp(0.38, 1, day), lerp(0.5, 1, day)],
      cloudScroll: (performance.now() / 1000) * 0.0035,
    };

    if (this.player.headUnderwater) {
      sky.fog = [0.09, 0.24, 0.42];
      sky.horizon = sky.fog.slice();
      sky.top = [0.06, 0.18, 0.34];
      sky.daylight *= 0.8;
    }
    return sky;
  }

  /* -------------------------------------------------------------- one frame */

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - (this.lastTime || now)) / 1000);
    this.lastTime = now;

    this.stream(this.started ? 7 : 14);

    if (!this.started) {
      // Hold on the title card until the ground under the player exists.
      if (this.meshed.size > 20 && this.ui.el.play.hidden) {
        this.ui.el.play.hidden = false;
        this.ui.el.bootNote.textContent = 'Your world is ready.';
      }
      this.drawFrame(dt, true);
      return;
    }

    const panels = this.ui.anyPanelOpen;
    this.input.updateHolds(now);

    // Look.
    const [lx, ly] = this.input.consumeLook();
    if (!panels) {
      this.player.yaw -= lx;
      this.player.pitch = clamp(this.player.pitch - ly, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    }

    // Move.
    this.player.update(dt, panels ? { forward: 0, strafe: 0, jump: false, sprint: false, up: false, down: false } : this.input);
    this.world.time = (this.world.time + dt / DAY_LENGTH) % 1;

    // What is under the crosshair?
    this.target = this.player.raycast();
    this.handleMining(dt, panels);
    this.handlePlacing(panels);

    if (this.player.dead && this.ui.el.death.hidden) {
      this.ui.showDeath(true, 'You fell, drowned or hit the ground too hard.');
    }

    this.swing = Math.max(0, this.swing - dt * 3.4);
    this.feedback(dt);
    this.ui.refreshVitals();
    this.drawFrame(dt, false);

    if (now - this.lastSave > 30000) { this.lastSave = now; this.save(); }
  }

  // Footsteps, splashes, damage flashes and the underwater tint.
  feedback(dt) {
    const p = this.player;

    const moved = Math.hypot(p.vx, p.vz) * dt;
    if (p.onGround && moved > 0.0005) {
      this.stepAccum += moved;
      if (this.stepAccum > 2.1) {
        this.stepAccum = 0;
        const below = this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
        if (below) this.sound.step(below);
      }
    }

    if (p.inWater !== this.wasInWater) {
      this.wasInWater = p.inWater;
      this.sound.splash();
    }
    if (p.health < this.lastHealth) this.sound.hurt();
    this.lastHealth = p.health;

    const wet = p.headUnderwater ? '1' : '0';
    if (this.tintWater.style.opacity !== wet) this.tintWater.style.opacity = wet;
    const hurt = p.hurtFlash > 0 ? (p.hurtFlash * 0.9).toFixed(2) : '0';
    if (this.tintHurt.style.opacity !== hurt) this.tintHurt.style.opacity = hurt;
  }

  handleMining(dt, panels) {
    const p = this.player;
    if (panels || !this.input.mining || !this.target || p.dead) {
      this.breakProgress = 0;
      this.breakTarget = null;
      return;
    }
    const key = this.target.x + ',' + this.target.y + ',' + this.target.z;
    if (key !== this.breakTarget) {
      this.breakTarget = key;
      this.breakProgress = 0;
    }
    const time = p.breakTime(this.target.id);
    if (time === Infinity) return;
    this.breakProgress += dt / time;
    this.hitClock -= dt;
    if (this.hitClock <= 0) { this.hitClock = 0.22; this.sound.hit(this.target.id); }
    this.swing = Math.max(this.swing, 0.35 + Math.sin(performance.now() / 90) * 0.12);
    if (this.breakProgress >= 1) {
      const def = B.blockDef(this.target.id);
      this.sound.dig(this.target.id);
      p.breakBlock(this.target);
      this.breakProgress = 0;
      this.breakTarget = null;
      if (!p.creative && def && def.drop) this.ui.refreshHotbar();
    }
  }

  handlePlacing(panels) {
    if (!this.input.consumePlace() || panels) return;
    const p = this.player;
    if (p.dead || !this.target) return;
    const id = p.held();
    if (!id) return;
    if (!p.creative && p.count(id) <= 0) {
      this.toast('Out of ' + B.blockDef(id).name);
      return;
    }
    if (p.placeBlock(this.target, id)) {
      this.sound.place(id);
      this.swing = 0.55;
      this.ui.refreshHotbar();
    }
  }

  drawFrame(dt, boot) {
    const sky = this.skyState();
    const cam = this.player.camera();
    this.renderer.render(cam, this.world, sky, {
      renderDistance: this.settings.renderDistance,
      fov: this.settings.fov + (this.input.sprint ? 4 : 0),
      target: this.target && !boot ? [this.target.x, this.target.y, this.target.z] : null,
      breakProgress: this.breakProgress,
      heldBlock: boot ? 0 : this.player.held(),
      headlamp: this.settings.headlamp,
      bob: this.player.bob,
      swing: this.swing,
    });

    this.frames++;
    const now = performance.now();
    if (now - this.fpsClock > 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsClock));
      this.frames = 0;
      this.fpsClock = now;
      if (this.settings.debug) {
        const p = this.player;
        this.ui.setDebug(
          `${this.fps} fps\n` +
          `x ${p.x.toFixed(1)}  y ${p.y.toFixed(1)}  z ${p.z.toFixed(1)}\n` +
          `chunks ${this.world.chunks.size}  sections ${this.renderer.stats.sections}\n` +
          `tris ${(this.renderer.stats.tris / 1000).toFixed(1)}k  time ${(this.world.time * 24).toFixed(1)}h`
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ startup */

function boot() {
  let game;
  try {
    game = new Game();
  } catch (err) {
    document.getElementById('boot-note').textContent = err.message;
    console.error(err);
    return;
  }
  window.game = game;
  requestAnimationFrame((t) => game.frame(t));
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline play is optional */ });
  });
}
