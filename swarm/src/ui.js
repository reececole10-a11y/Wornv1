// ---------------------------------------------------------------------------
// ui.js - the DOM half: bars, the level-up cards, the run summary.
// ---------------------------------------------------------------------------

import { WEAPONS, PASSIVES } from './weapons.js';

const $ = (id) => document.getElementById(id);
const BEST_KEY = 'swarm.best.v1';

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export class UI {
  constructor() {
    this.el = {
      clock: $('clock'), level: $('level'), kills: $('kills'), xp: $('xp-fill'),
      hp: $('hp-fill'), hpText: $('hp-text'), loadout: $('loadout'),
      levelup: $('levelup'), cards: $('cards'), banner: $('banner'),
      pause: $('pause'), over: $('over'), overStats: $('over-stats'), best: $('best'),
      title: $('title'), titleBest: $('title-best'), stick: $('stick'), knob: $('knob'),
    };
    this.lastLoadout = '';
    window.addEventListener('stick', (e) => {
      const d = e.detail;
      if (!d.show) { this.el.stick.hidden = true; return; }
      this.el.stick.hidden = false;
      this.el.stick.style.left = d.x + 'px';
      this.el.stick.style.top = d.y + 'px';
      this.el.knob.style.transform = `translate(${d.kx}px, ${d.ky}px)`;
    });
    this.showBest();
  }

  best() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY)) || null; } catch { return null; }
  }

  saveBest(run) {
    const best = this.best();
    if (best && best.time >= run.time) return false;
    try { localStorage.setItem(BEST_KEY, JSON.stringify(run)); } catch { /* storage blocked */ }
    return true;
  }

  showBest() {
    const b = this.best();
    this.el.titleBest.textContent = b ? `Best: ${formatTime(b.time)} · level ${b.level} · ${b.kills} kills` : '';
  }

  /* -------------------------------------------------------------- hud tick */

  update(game) {
    const p = game.player;
    this.el.clock.textContent = formatTime(game.time);
    this.el.level.textContent = 'Lv ' + p.level;
    this.el.kills.textContent = game.kills + ' kills';
    this.el.xp.style.width = Math.min(100, (p.xp / p.xpNext) * 100) + '%';
    this.el.hp.style.width = Math.max(0, (p.hp / p.maxHp) * 100) + '%';
    this.el.hpText.textContent = Math.ceil(p.hp) + ' / ' + p.maxHp;

    // The loadout chips only change on a level-up, so rebuild them rarely.
    const sig = game.weapons.map((w) => w.id + w.level).join() + '|' +
      Object.entries(game.taken).filter(([id]) => PASSIVES[id]).map(([id, n]) => id + n).join();
    if (sig !== this.lastLoadout) {
      this.lastLoadout = sig;
      const chips = game.weapons.map((w) =>
        `<span class="chip"><i class="pip" style="background:${WEAPONS[w.id].color}"></i>${WEAPONS[w.id].name} ${w.level}</span>`);
      for (const [id, n] of Object.entries(game.taken)) {
        if (!PASSIVES[id]) continue;
        chips.push(`<span class="chip"><i class="pip" style="background:#9fb4c7"></i>${PASSIVES[id].name} ${n}</span>`);
      }
      this.el.loadout.innerHTML = chips.join('');
    }
  }

  banner(text) {
    const el = this.el.banner;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  /* ------------------------------------------------------------- level up */

  offer(game, choices) {
    this.el.cards.innerHTML = '';
    for (const c of choices) {
      const btn = document.createElement('button');
      btn.className = 'card';
      btn.innerHTML = `
        <i class="mark" style="background:${c.color};color:${c.color}"></i>
        <span>
          <span class="name">${c.name}</span>
          <span class="text">${c.text}</span>
        </span>
        <span class="lv">${c.kind === 'new' ? 'NEW' : 'Lv ' + c.level}</span>`;
      btn.addEventListener('click', () => {
        this.el.levelup.hidden = true;
        game.take(c);
        this.update(game);
      });
      this.el.cards.appendChild(btn);
    }
    this.el.levelup.hidden = false;
  }

  /* ------------------------------------------------------------- game over */

  gameOver(game) {
    const run = { time: Math.floor(game.time), level: game.player.level, kills: game.kills };
    const isBest = this.saveBest(run);
    this.el.overStats.innerHTML = `
      <div>SURVIVED<b>${formatTime(run.time)}</b></div>
      <div>LEVEL<b>${run.level}</b></div>
      <div>KILLS<b>${run.kills}</b></div>`;
    const best = this.best();
    this.el.best.textContent = isBest ? 'A new best run.' : best ? `Best: ${formatTime(best.time)}` : '';
    this.el.over.hidden = false;
    this.showBest();
  }
}
