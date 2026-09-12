// ---------------------------------------------------------------------------
// input.js - one thumb. Touch anywhere and a stick appears under it; aiming is
// automatic, so movement is the only thing the player has to think about.
// ---------------------------------------------------------------------------

export class Input {
  constructor(target) {
    this.dx = 0;
    this.dy = 0;
    this.stick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.keys = new Set();

    const opts = { passive: false };
    target.addEventListener('touchstart', (e) => this.down(e), opts);
    target.addEventListener('touchmove', (e) => this.move(e), opts);
    target.addEventListener('touchend', (e) => this.up(e), opts);
    target.addEventListener('touchcancel', (e) => this.up(e), opts);
    target.addEventListener('mousedown', (e) => this.down(e));
    window.addEventListener('mousemove', (e) => this.move(e));
    window.addEventListener('mouseup', (e) => this.up(e));

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
      this.sync();
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.key.toLowerCase()); this.sync(); });
    window.addEventListener('blur', () => { this.keys.clear(); this.sync(); });
  }

  point(e) {
    const t = e.changedTouches ? e.changedTouches[0] : e;
    return { id: e.changedTouches ? t.identifier : 'mouse', x: t.clientX, y: t.clientY };
  }

  down(e) {
    if (e.cancelable) e.preventDefault();
    const p = this.point(e);
    this.stick = { active: true, id: p.id, ox: p.x, oy: p.y, x: p.x, y: p.y };
    this.emit();
  }

  move(e) {
    if (!this.stick.active) return;
    if (e.cancelable) e.preventDefault();
    const list = e.changedTouches ? [...e.changedTouches] : [e];
    for (const t of list) {
      const id = e.changedTouches ? t.identifier : 'mouse';
      if (id !== this.stick.id) continue;
      const R = 54;
      let dx = t.clientX - this.stick.ox;
      let dy = t.clientY - this.stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      this.stick.x = this.stick.ox + dx;
      this.stick.y = this.stick.oy + dy;
      this.dx = dx / R;
      this.dy = dy / R;
      this.emit();
    }
  }

  up(e) {
    const list = e.changedTouches ? [...e.changedTouches] : [e];
    for (const t of list) {
      const id = e.changedTouches ? t.identifier : 'mouse';
      if (id !== this.stick.id) continue;
      this.stick.active = false;
      this.dx = this.dy = 0;
      this.sync();
      this.emit();
    }
  }

  sync() {
    if (this.stick.active) return;
    const k = this.keys;
    const x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const y = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    const len = Math.hypot(x, y) || 1;
    this.dx = x / len;
    this.dy = y / len;
  }

  emit() {
    window.dispatchEvent(new CustomEvent('stick', {
      detail: this.stick.active
        ? { show: true, x: this.stick.ox, y: this.stick.oy, kx: this.stick.x - this.stick.ox, ky: this.stick.y - this.stick.oy }
        : { show: false },
    }));
  }
}
