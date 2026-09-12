// ---------------------------------------------------------------------------
// input.js - one input object fed by three sources: touch (a thumbstick on the
// left, look-drag and taps on the right), the on-screen buttons, and a
// keyboard/mouse for anyone playing on a desktop.
// ---------------------------------------------------------------------------

export class Input {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;

    this.forward = 0;
    this.strafe = 0;
    this.jump = false;
    this.sprint = false;
    this.up = false;
    this.down = false;
    this.mining = false;      // held: break the targeted block
    this.placeQueued = false; // one-shot: place a block
    this.lookX = 0;           // accumulated look delta, consumed each frame
    this.lookY = 0;
    this.pointerLocked = false;
    this.onFlyToggle = null;
    this.onSlot = null;
    this.onInventory = null;
    this.onPause = null;

    this.touches = new Map();
    this.joystick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.keys = new Set();

    this.bindTouch();
    this.bindKeyboard();
    this.bindMouse();
  }

  // --------------------------------------------------------------- touch

  bindTouch() {
    const el = this.canvas;
    const opts = { passive: false };
    el.addEventListener('touchstart', (e) => this.touchStart(e), opts);
    el.addEventListener('touchmove', (e) => this.touchMove(e), opts);
    el.addEventListener('touchend', (e) => this.touchEnd(e), opts);
    el.addEventListener('touchcancel', (e) => this.touchEnd(e), opts);
  }

  touchStart(e) {
    e.preventDefault();
    const half = window.innerWidth * 0.45;
    for (const t of e.changedTouches) {
      if (t.clientX < half && !this.joystick.active) {
        this.joystick = { active: true, id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
        this.touches.set(t.identifier, { role: 'move' });
        window.dispatchEvent(new CustomEvent('stick', { detail: { show: true, x: t.clientX, y: t.clientY, dx: 0, dy: 0 } }));
      } else {
        this.touches.set(t.identifier, {
          role: 'look', x: t.clientX, y: t.clientY, startX: t.clientX, startY: t.clientY,
          time: performance.now(), moved: false, holding: false,
        });
      }
    }
  }

  touchMove(e) {
    e.preventDefault();
    const sens = this.settings.sensitivity;
    for (const t of e.changedTouches) {
      const rec = this.touches.get(t.identifier);
      if (!rec) continue;
      if (rec.role === 'move') {
        const R = 58;
        let dx = t.clientX - this.joystick.ox;
        let dy = t.clientY - this.joystick.oy;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        this.strafe = dx / R;
        this.forward = -dy / R;
        this.sprint = d > R * 0.92;
        window.dispatchEvent(new CustomEvent('stick', { detail: { show: true, x: this.joystick.ox, y: this.joystick.oy, dx, dy } }));
      } else {
        const dx = t.clientX - rec.x, dy = t.clientY - rec.y;
        rec.x = t.clientX; rec.y = t.clientY;
        if (Math.hypot(t.clientX - rec.startX, t.clientY - rec.startY) > 12) rec.moved = true;
        this.lookX += dx * sens * 0.0028;
        this.lookY += dy * sens * 0.0028;
      }
    }
  }

  touchEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const rec = this.touches.get(t.identifier);
      this.touches.delete(t.identifier);
      if (!rec) continue;
      if (rec.role === 'move') {
        this.joystick.active = false;
        this.forward = this.strafe = 0;
        this.sprint = false;
        window.dispatchEvent(new CustomEvent('stick', { detail: { show: false } }));
      } else {
        if (rec.holding) this.mining = false;
        // A quick tap that did not turn the camera places a block.
        else if (!rec.moved && performance.now() - rec.time < 260) this.placeQueued = true;
      }
    }
    // If every look finger is up, stop mining.
    if (![...this.touches.values()].some((r) => r.role === 'look' && r.holding)) this.mining = false;
  }

  // Called once a frame: a look finger held still for a moment starts mining.
  updateHolds(now) {
    for (const rec of this.touches.values()) {
      if (rec.role !== 'look' || rec.holding) continue;
      if (!rec.moved && now - rec.time > 220) {
        rec.holding = true;
        this.mining = true;
      }
    }
  }

  // ------------------------------------------------------------ keyboard

  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'f') this.onFlyToggle && this.onFlyToggle();
      if (k === 'e') this.onInventory && this.onInventory();
      if (k === 'escape') this.onPause && this.onPause();
      if (k >= '1' && k <= '9') this.onSlot && this.onSlot(+k - 1);
      if ([' ', 'w', 'a', 's', 'd'].includes(k)) e.preventDefault();
      this.syncKeys();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
      this.syncKeys();
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.syncKeys(); });
  }

  syncKeys() {
    const k = this.keys;
    const kb = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0);
    const ks = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    if (!this.joystick.active) {
      this.forward = kb;
      this.strafe = ks;
      this.sprint = k.has('shift') && kb !== 0;
    }
    this.jump = k.has(' ') || this.buttonJump === true;
    this.up = k.has(' ') || this.buttonUp === true;
    this.down = k.has('control') || k.has('c') || this.buttonDown === true;
  }

  // --------------------------------------------------------------- mouse

  bindMouse() {
    const el = this.canvas;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) { el.requestPointerLock && el.requestPointerLock(); return; }
      if (e.button === 0) this.mining = true;
      if (e.button === 2) this.placeQueued = true;
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mining = false; });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === el;
      if (!this.pointerLocked) this.mining = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      const sens = this.settings.sensitivity;
      this.lookX += e.movementX * sens * 0.0022;
      this.lookY += e.movementY * sens * 0.0022;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.onSlot) return;
      this.wheelAccum = (this.wheelAccum || 0) + e.deltaY;
      if (Math.abs(this.wheelAccum) > 40) {
        this.onSlot(null, Math.sign(this.wheelAccum));
        this.wheelAccum = 0;
      }
    }, { passive: true });
  }

  // --------------------------------------------------- on-screen buttons

  // Wires a DOM button to a boolean that stays true while it is held.
  bindButton(el, onDown, onUp) {
    if (!el) return;
    const down = (e) => { e.preventDefault(); el.classList.add('pressed'); onDown && onDown(); };
    const up = (e) => { e.preventDefault(); el.classList.remove('pressed'); onUp && onUp(); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    el.addEventListener('mousedown', down);
    el.addEventListener('mouseup', up);
    el.addEventListener('mouseleave', (e) => { if (el.classList.contains('pressed')) up(e); });
  }

  consumeLook() {
    const out = [this.lookX, this.lookY];
    this.lookX = 0; this.lookY = 0;
    return out;
  }

  consumePlace() {
    const v = this.placeQueued;
    this.placeQueued = false;
    return v;
  }
}
