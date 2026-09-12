// ---------------------------------------------------------------------------
// ui.js - the DOM layer: hotbar, inventory, crafting, settings, vitals.
// The icons are drawn from the same texture atlas the world uses, so a new
// block shows up in the inventory without any extra art.
// ---------------------------------------------------------------------------

import * as B from './blocks.js';
import { getAtlasCanvas, tileIndex, TILE, COLS } from './textures.js';

const $ = (id) => document.getElementById(id);
const iconCache = new Map();

// A little isometric cube, drawn by skewing three tiles out of the atlas.
export function blockIcon(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  const def = B.blockDef(id);
  if (!def) return '';

  const size = 48;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const atlas = getAtlasCanvas();

  const drawTile = (name, a, b, cc, d, e, f) => {
    const index = tileIndex(name);
    const sx = (index % COLS) * TILE, sy = ((index / COLS) | 0) * TILE;
    ctx.save();
    ctx.setTransform(a, b, cc, d, e, f);
    ctx.drawImage(atlas, sx, sy, TILE, TILE, 0, 0, 1, 1);
    ctx.restore();
  };

  if (def.render === 'cross') {
    const index = tileIndex(def.tiles[0]);
    const sx = (index % COLS) * TILE, sy = ((index / COLS) | 0) * TILE;
    ctx.drawImage(atlas, sx, sy, TILE, TILE, 4, 4, size - 8, size - 8);
  } else {
    // Diamond for the top face, two parallelograms for the visible sides.
    const cx = size / 2;
    if (!def.opaque) {
      // Glass and leaves are mostly holes; back them with a pale cube so the
      // icon does not read as a black square.
      ctx.fillStyle = 'rgba(180, 196, 206, 0.5)';
      ctx.beginPath();
      ctx.moveTo(size / 2, size * 0.0625); ctx.lineTo(size, size * 0.3333);
      ctx.lineTo(size, size * 0.667); ctx.lineTo(size / 2, size * 0.9375);
      ctx.lineTo(0, size * 0.667); ctx.lineTo(0, size * 0.3333);
      ctx.closePath(); ctx.fill();
    }
    const top = size * 0.0625, mid = size * 0.3333;
    const dia = size * 0.604, outB = size * 0.667, cenB = size * 0.9375;
    const halfW = cx, halfH = mid - top, drop = outB - mid;
    drawTile(def.tiles[2], halfW, -halfH, halfW, halfH, 0, mid);      // top
    drawTile(def.tiles[1], halfW, halfH, 0, drop, 0, mid);            // left side
    drawTile(def.tiles[0], halfW, -halfH, 0, drop, cx, dia);          // right side

    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath();
    ctx.moveTo(0, mid); ctx.lineTo(cx, dia); ctx.lineTo(cx, cenB); ctx.lineTo(0, outB);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.beginPath();
    ctx.moveTo(cx, dia); ctx.lineTo(size, mid); ctx.lineTo(size, outB); ctx.lineTo(cx, cenB);
    ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  const url = c.toDataURL();
  iconCache.set(id, url);
  return url;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      hotbar: $('hotbar'), hearts: $('hearts'), bubbles: $('bubbles'), debug: $('debug'),
      toast: $('toast'), inventory: $('inventory'), invGrid: $('inv-grid'), craft: $('craft-list'),
      menu: $('menu'), death: $('death'), boot: $('boot'), bootNote: $('boot-note'), play: $('btn-play'),
      stick: $('stick'), knob: $('stick-knob'), flyPad: $('fly-pad'), deathNote: $('death-note'),
    };
    this.lastHealth = -1;
    this.lastBreath = -1;
    this.buildHotbar();
    this.bindPanels();
    this.bindStick();
  }

  /* ----------------------------------------------------------------- hotbar */

  buildHotbar() {
    const bar = this.el.hotbar;
    bar.innerHTML = '';
    this.game.player.hotbar.forEach((id, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.i = i;
      slot.innerHTML = `<img alt="" /><span class="count"></span>`;
      // Tap selects; a long press opens the block picker for that slot.
      let timer = null;
      const start = (e) => {
        e.preventDefault();
        timer = setTimeout(() => { timer = null; this.openInventory(i); }, 420);
      };
      const end = (e) => {
        e.preventDefault();
        if (timer) { clearTimeout(timer); timer = null; this.game.selectSlot(i); }
      };
      slot.addEventListener('touchstart', start, { passive: false });
      slot.addEventListener('touchend', end, { passive: false });
      slot.addEventListener('mousedown', start);
      slot.addEventListener('mouseup', end);
      bar.appendChild(slot);
    });
    this.refreshHotbar();
  }

  refreshHotbar() {
    const p = this.game.player;
    [...this.el.hotbar.children].forEach((slot, i) => {
      const id = p.hotbar[i];
      slot.classList.toggle('active', i === p.slot);
      const img = slot.querySelector('img');
      const count = slot.querySelector('.count');
      if (id) {
        img.src = blockIcon(id);
        img.style.visibility = 'visible';
        const n = p.count(id);
        count.textContent = p.creative ? '' : n > 0 ? n : '0';
        slot.style.opacity = p.creative || n > 0 ? 1 : 0.45;
      } else {
        img.style.visibility = 'hidden';
        count.textContent = '';
      }
    });
  }

  /* -------------------------------------------------------------- inventory */

  openInventory(slotIndex = null) {
    this.targetSlot = slotIndex === null ? this.game.player.slot : slotIndex;
    this.renderInventory();
    this.renderCrafting();
    this.el.inventory.hidden = false;
  }

  renderInventory() {
    const p = this.game.player;
    const grid = this.el.invGrid;
    grid.innerHTML = '';
    for (const id of B.PLACEABLE) {
      const def = B.blockDef(id);
      const have = p.count(id);
      const cell = document.createElement('button');
      cell.className = 'cell' + (have > 0 || p.creative ? '' : ' out');
      cell.innerHTML = `<img alt="" src="${blockIcon(id)}" /><span>${p.creative ? def.name : have}</span>`;
      cell.title = def.name;
      cell.addEventListener('click', () => {
        p.hotbar[this.targetSlot] = id;
        p.slot = this.targetSlot;
        this.refreshHotbar();
        this.el.inventory.hidden = true;
        this.game.toast(def.name);
      });
      grid.appendChild(cell);
    }
  }

  renderCrafting() {
    const p = this.game.player;
    const list = this.el.craft;
    list.innerHTML = '';
    for (const r of B.RECIPES) {
      const can = r.needs.every(([id, n]) => p.count(id) >= n);
      const row = document.createElement('div');
      row.className = 'recipe' + (can ? '' : ' out');
      const needs = r.needs.map(([id, n]) => `${n} ${B.blockDef(id).name}`).join(' + ');
      row.innerHTML = `<img alt="" src="${blockIcon(r.out)}" />
        <div class="what">${r.count} ${B.blockDef(r.out).name}<br><span style="opacity:.6">${needs}</span></div>`;
      const btn = document.createElement('button');
      btn.textContent = 'Craft';
      btn.disabled = !can;
      btn.addEventListener('click', () => {
        if (!r.needs.every(([id, n]) => p.count(id) >= n)) return;
        r.needs.forEach(([id, n]) => p.take(id, n));
        p.give(r.out, r.count);
        this.renderCrafting();
        this.renderInventory();
        this.refreshHotbar();
        this.game.toast(`Crafted ${r.count} ${B.blockDef(r.out).name}`);
      });
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  /* ------------------------------------------------------------------ vitals */

  refreshVitals() {
    const p = this.game.player;
    const health = p.creative || !p.damageEnabled ? -1 : Math.ceil(p.health);
    const breath = p.headUnderwater ? Math.ceil(p.breath) : -1;
    if (health !== this.lastHealth) {
      this.lastHealth = health;
      this.el.hearts.innerHTML = '';
      if (health >= 0) {
        for (let i = 0; i < p.maxHealth; i++) {
          const d = document.createElement('div');
          d.className = 'pip heart' + (i < health ? '' : ' empty');
          this.el.hearts.appendChild(d);
        }
      }
    }
    if (breath !== this.lastBreath) {
      this.lastBreath = breath;
      this.el.bubbles.innerHTML = '';
      if (breath >= 0) {
        for (let i = 0; i < breath; i++) {
          const d = document.createElement('div');
          d.className = 'pip bubble';
          this.el.bubbles.appendChild(d);
        }
      }
    }
  }

  setDebug(text) {
    this.el.debug.textContent = text;
  }

  toast(message) {
    const t = this.el.toast;
    t.textContent = message;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
  }

  /* ------------------------------------------------------------------ panels */

  bindPanels() {
    for (const btn of document.querySelectorAll('[data-close]')) {
      btn.addEventListener('click', () => {
        this.el.inventory.hidden = true;
        this.el.menu.hidden = true;
      });
    }
    $('btn-menu').addEventListener('click', () => this.toggleMenu());
    $('btn-respawn').addEventListener('click', () => this.game.respawn());
  }

  toggleMenu() {
    const menu = this.el.menu;
    if (menu.hidden) { this.game.syncSettingsUI(); menu.hidden = false; }
    else menu.hidden = true;
  }

  get anyPanelOpen() {
    return !this.el.inventory.hidden || !this.el.menu.hidden || !this.el.death.hidden || !this.el.boot.hidden;
  }

  showDeath(show, note = '') {
    this.el.death.hidden = !show;
    if (show) this.el.deathNote.textContent = note;
  }

  /* ------------------------------------------------- thumbstick visual */

  bindStick() {
    window.addEventListener('stick', (e) => {
      const d = e.detail;
      if (!d.show) { this.el.stick.hidden = true; return; }
      this.el.stick.hidden = false;
      this.el.stick.style.left = d.x + 'px';
      this.el.stick.style.top = d.y + 'px';
      this.el.knob.style.transform = `translate(${d.dx || 0}px, ${d.dy || 0}px)`;
    });
  }
}
