// ---------------------------------------------------------------------------
// textures.js - every texture in the game is drawn here, pixel by pixel, into
// one atlas canvas. No image files to load, nothing to 404, and the whole
// thing costs about two milliseconds at startup.
// ---------------------------------------------------------------------------

import { mulberry32 } from './noise.js';

export const TILE = 16;      // texels per block face
export const COLS = 16;      // tiles per atlas row
export const ATLAS_SIZE = TILE * COLS;

const names = [];
const painters = new Map();

function tile(name, paint) {
  painters.set(name, paint);
  names.push(name);
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

// Each painter gets `p`, a pixel plotter in tile-local coordinates, and `rnd`,
// a generator seeded from the tile name so textures never change between runs.
function makeTools(ctx, ox, oy, seed) {
  const rnd = mulberry32(seed);
  const p = (x, y, r, g, b, a = 1) => {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    ctx.fillStyle = `rgba(${clamp255(r)},${clamp255(g)},${clamp255(b)},${a})`;
    ctx.fillRect(ox + x, oy + y, 1, 1);
  };
  // Fill the tile with a base colour plus per-pixel grain.
  const grain = (r, g, b, amount = 14, fn = null) => {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const n = (rnd() - 0.5) * 2 * amount;
        let c = [r + n, g + n, b + n];
        if (fn) c = fn(x, y, c, rnd) || c;
        p(x, y, c[0], c[1], c[2]);
      }
    }
  };
  const clear = () => ctx.clearRect(ox, oy, TILE, TILE);
  return { p, grain, clear, rnd };
}

/* -------------------------------------------------------------------------
   Ground
   ---------------------------------------------------------------------- */

tile('dirt', ({ grain, p, rnd }) => {
  grain(134, 98, 66, 16);
  for (let i = 0; i < 26; i++) {
    const x = (rnd() * TILE) | 0, y = (rnd() * TILE) | 0;
    p(x, y, 108, 76, 50);
  }
});

tile('grass_top', ({ grain, p, rnd }) => {
  grain(94, 152, 62, 18);
  for (let i = 0; i < 30; i++) p((rnd() * TILE) | 0, (rnd() * TILE) | 0, 76, 128, 48);
  for (let i = 0; i < 14; i++) p((rnd() * TILE) | 0, (rnd() * TILE) | 0, 116, 174, 76);
});

tile('grass_side', ({ grain, p, rnd }) => {
  grain(134, 98, 66, 16);
  // Ragged green lip over the dirt, a couple of blades hanging lower.
  for (let x = 0; x < TILE; x++) {
    const depth = 3 + ((rnd() * 2.6) | 0);
    for (let y = 0; y < depth; y++) {
      const n = (rnd() - 0.5) * 28;
      p(x, y, 94 + n, 152 + n, 62 + n);
    }
    if (rnd() < 0.25) p(x, depth, 84, 138, 56);
  }
});

tile('snow', ({ grain, p, rnd }) => {
  grain(242, 246, 252, 8);
  for (let i = 0; i < 10; i++) p((rnd() * TILE) | 0, (rnd() * TILE) | 0, 255, 255, 255);
});

tile('snow_side', ({ grain, p, rnd }) => {
  grain(134, 98, 66, 16);
  for (let x = 0; x < TILE; x++) {
    const depth = 4 + ((rnd() * 2.4) | 0);
    for (let y = 0; y < depth; y++) p(x, y, 240 + rnd() * 12, 245 + rnd() * 8, 252);
  }
});

tile('sand', ({ grain, p, rnd }) => {
  grain(220, 208, 162, 12);
  for (let i = 0; i < 18; i++) p((rnd() * TILE) | 0, (rnd() * TILE) | 0, 200, 186, 140);
});

tile('sandstone_top', ({ grain }) => grain(224, 212, 168, 9));

tile('sandstone', ({ grain, p }) => {
  grain(222, 210, 166, 10);
  for (let x = 0; x < TILE; x++) {
    p(x, 0, 196, 182, 138);
    p(x, 4, 204, 190, 146);
    p(x, 11, 204, 190, 146);
    p(x, 15, 190, 176, 132);
  }
});

tile('gravel', ({ grain, p, rnd }) => {
  grain(128, 124, 120, 10);
  for (let i = 0; i < 40; i++) {
    const x = (rnd() * TILE) | 0, y = (rnd() * TILE) | 0;
    const v = rnd();
    if (v < 0.4) p(x, y, 92, 88, 86);
    else if (v < 0.8) p(x, y, 158, 152, 148);
    else p(x, y, 112, 96, 82);
  }
});

/* -------------------------------------------------------------------------
   Stone family
   ---------------------------------------------------------------------- */

tile('stone', ({ grain, p, rnd }) => {
  grain(129, 129, 129, 12);
  for (let i = 0; i < 16; i++) p((rnd() * TILE) | 0, (rnd() * TILE) | 0, 108, 108, 108);
});

tile('cobblestone', ({ grain, p, rnd }) => {
  grain(112, 112, 112, 8);
  // Four rough stones with dark mortar between them.
  const stones = [[1, 1, 6, 5], [9, 1, 6, 6], [1, 8, 7, 7], [9, 9, 6, 6]];
  for (const [sx, sy, w, h] of stones) {
    for (let y = sy; y < sy + h; y++) {
      for (let x = sx; x < sx + w; x++) {
        if (x >= TILE || y >= TILE) continue;
        const edge = x === sx || y === sy || x === sx + w - 1 || y === sy + h - 1;
        const n = (rnd() - 0.5) * 22;
        const base = edge ? 96 : 148;
        p(x, y, base + n, base + n, base + n);
      }
    }
  }
});

tile('stone_brick', ({ grain, p }) => {
  grain(124, 124, 124, 10);
  for (let x = 0; x < TILE; x++) { p(x, 7, 92, 92, 92); p(x, 15, 92, 92, 92); }
  for (let y = 0; y < 8; y++) p(7, y, 92, 92, 92);
  for (let y = 8; y < TILE; y++) p(13, y, 92, 92, 92);
});

tile('brick', ({ grain, p }) => {
  grain(150, 74, 58, 10);
  const mortar = (x, y) => p(x, y, 186, 180, 172);
  for (let x = 0; x < TILE; x++) { mortar(x, 3); mortar(x, 7); mortar(x, 11); mortar(x, 15); }
  for (let y = 0; y < 3; y++) mortar(4, y);
  for (let y = 4; y < 7; y++) mortar(11, y);
  for (let y = 8; y < 11; y++) mortar(4, y);
  for (let y = 12; y < 15; y++) mortar(11, y);
});

tile('bedrock', ({ grain, p, rnd }) => {
  grain(62, 62, 66, 10);
  for (let i = 0; i < 22; i++) {
    const x = (rnd() * TILE) | 0, y = (rnd() * TILE) | 0;
    const w = 2 + ((rnd() * 3) | 0);
    for (let k = 0; k < w; k++) p(x + k, y, rnd() < 0.5 ? 38 : 96, rnd() < 0.5 ? 38 : 96, 100);
  }
});

function ore(name, r, g, b, hi) {
  tile(name, ({ grain, p, rnd }) => {
    grain(129, 129, 129, 12);
    const blobs = 4 + ((rnd() * 2) | 0);
    for (let i = 0; i < blobs; i++) {
      const cx = 2 + ((rnd() * 12) | 0), cy = 2 + ((rnd() * 12) | 0);
      const size = 2 + ((rnd() * 2) | 0);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (rnd() < 0.2) continue;
          const bright = rnd() < 0.35;
          p(cx + x, cy + y, bright ? hi[0] : r, bright ? hi[1] : g, bright ? hi[2] : b);
        }
      }
    }
  });
}
ore('coal_ore', 42, 42, 42, [86, 86, 86]);
ore('iron_ore', 186, 146, 116, [214, 186, 160]);
ore('gold_ore', 226, 190, 72, [252, 228, 130]);

/* -------------------------------------------------------------------------
   Trees and plants
   ---------------------------------------------------------------------- */

tile('log_side', ({ grain, p, rnd }) => {
  grain(128, 100, 60, 10);
  for (let x = 0; x < TILE; x++) {
    if (rnd() < 0.35) for (let y = 0; y < TILE; y++) p(x, y, 102, 78, 44 + (rnd() - 0.5) * 10);
  }
  for (let y = 0; y < TILE; y++) { p(0, y, 96, 72, 40); p(15, y, 96, 72, 40); }
});

tile('log_top', ({ grain, p }) => {
  grain(162, 130, 84, 10);
  // Growth rings.
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (Math.abs(d - 2) < 0.6 || Math.abs(d - 4.5) < 0.6 || Math.abs(d - 7) < 0.6) {
        p(x, y, 128, 98, 58);
      }
    }
  }
});

tile('leaves', ({ clear, p, rnd }) => {
  clear();
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (rnd() < 0.16) continue;            // holes you can see the sky through
      const n = (rnd() - 0.5) * 40;
      const dark = rnd() < 0.3;
      p(x, y, (dark ? 44 : 62) + n, (dark ? 96 : 124) + n, (dark ? 34 : 46) + n);
    }
  }
});

tile('planks', ({ grain, p, rnd }) => {
  grain(166, 130, 82, 10);
  for (let x = 0; x < TILE; x++) { p(x, 0, 122, 94, 56); p(x, 5, 122, 94, 56); p(x, 10, 122, 94, 56); p(x, 15, 122, 94, 56); }
  for (let i = 0; i < 24; i++) {
    const x = (rnd() * TILE) | 0, y = (rnd() * TILE) | 0;
    if (y % 5 === 0) continue;
    p(x, y, 146, 112, 68);
  }
  p(3, 3, 122, 94, 56); p(11, 8, 122, 94, 56);
});

tile('cactus_side', ({ grain, p, rnd }) => {
  grain(62, 124, 58, 10);
  for (let y = 0; y < TILE; y++) { p(0, y, 46, 98, 44); p(15, y, 46, 98, 44); p(4, y, 52, 108, 48); p(11, y, 52, 108, 48); }
  for (let i = 0; i < 8; i++) p(2 + ((rnd() * 12) | 0), (rnd() * TILE) | 0, 214, 226, 196);
});

tile('cactus_top', ({ grain, p }) => {
  grain(72, 138, 64, 10);
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) p(x, y, 56, 112, 50);
});

function cross(name, paint) {
  tile(name, (t) => { t.clear(); paint(t); });
}

cross('tall_grass', ({ p, rnd }) => {
  for (let i = 0; i < 7; i++) {
    const x = 1 + i * 2 + ((rnd() * 1.4) | 0);
    const h = 6 + ((rnd() * 7) | 0);
    for (let y = 0; y < h; y++) {
      const n = (rnd() - 0.5) * 22;
      p(x + (y > h - 3 ? (rnd() < 0.5 ? -1 : 1) : 0), 15 - y, 78 + n, 142 + n, 54 + n);
    }
  }
});

cross('flower_red', ({ p, rnd }) => {
  for (let y = 6; y < 16; y++) p(7 + (y > 11 ? 0 : 1), y, 64 + rnd() * 12, 126, 48);
  p(6, 10, 60, 120, 44); p(10, 9, 60, 120, 44);
  const petals = [[6, 3], [7, 3], [8, 3], [9, 3], [5, 4], [6, 4], [8, 4], [9, 4], [10, 4], [6, 5], [7, 5], [8, 5], [9, 5], [7, 2], [8, 2]];
  for (const [x, y] of petals) p(x, y, 198 + rnd() * 30, 48, 54);
  p(7, 4, 244, 212, 96); p(8, 4, 244, 212, 96);
});

cross('flower_yellow', ({ p, rnd }) => {
  for (let y = 7; y < 16; y++) p(8, y, 64 + rnd() * 12, 126, 48);
  p(6, 11, 60, 120, 44); p(10, 10, 60, 120, 44);
  const petals = [[6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [6, 5], [7, 5], [9, 5], [10, 5], [7, 6], [8, 6], [9, 6], [7, 3], [8, 3], [9, 3]];
  for (const [x, y] of petals) p(x, y, 236, 204 + rnd() * 20, 58);
  p(8, 5, 168, 122, 40);
});

/* -------------------------------------------------------------------------
   Built and glowing things
   ---------------------------------------------------------------------- */

tile('water', ({ grain, p, rnd }) => {
  grain(58, 104, 196, 10);
  for (let i = 0; i < 5; i++) {
    const y = (rnd() * TILE) | 0;
    for (let x = 0; x < TILE; x++) if (rnd() < 0.6) p(x, y, 84, 132, 220);
  }
});

tile('glass', ({ clear, p }) => {
  clear();
  for (let x = 0; x < TILE; x++) { p(x, 0, 214, 232, 240, 0.95); p(x, 15, 214, 232, 240, 0.95); }
  for (let y = 0; y < TILE; y++) { p(0, y, 214, 232, 240, 0.95); p(15, y, 214, 232, 240, 0.95); }
  for (let i = 0; i < 6; i++) { p(3 + i, 4 + i, 255, 255, 255, 0.9); p(4 + i, 4 + i, 240, 250, 255, 0.7); }
});

tile('glowstone', ({ grain, p, rnd }) => {
  grain(214, 176, 88, 14);
  for (let i = 0; i < 12; i++) {
    const x = (rnd() * TILE) | 0, y = (rnd() * TILE) | 0;
    p(x, y, 255, 240, 176); p(x + 1, y, 250, 226, 150); p(x, y + 1, 250, 226, 150);
  }
});

tile('lantern', ({ grain, p }) => {
  grain(74, 62, 52, 8);
  for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) {
    const edge = x === 3 || x === 12 || y === 3 || y === 12;
    if (edge) p(x, y, 96, 80, 62);
    else p(x, y, 255, 226 - (y - 4) * 6, 132);
  }
  for (let y = 0; y < 3; y++) p(8, y, 108, 92, 70);
});

tile('lantern_top', ({ grain, p }) => {
  grain(84, 70, 56, 8);
  for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) p(x, y, 255, 232, 150);
});

function wool(name, r, g, b) {
  tile(name, ({ grain, p, rnd }) => {
    grain(r, g, b, 8);
    for (let i = 0; i < 30; i++) {
      const x = (rnd() * TILE) | 0, y = (rnd() * TILE) | 0;
      const d = rnd() < 0.5 ? -14 : 14;
      p(x, y, r + d, g + d, b + d);
    }
  });
}
wool('wool_white', 232, 232, 228);
wool('wool_red', 178, 58, 54);
wool('wool_blue', 58, 84, 176);
wool('wool_green', 74, 142, 62);
wool('wool_black', 34, 34, 38);

/* -------------------------------------------------------------------------
   Mining crack overlay - eight stages, drawn over the block being broken
   ---------------------------------------------------------------------- */

export const CRACK_STAGES = 8;
for (let s = 0; s < CRACK_STAGES; s++) {
  tile(`crack_${s}`, ({ clear, p, rnd }) => {
    clear();
    const branches = 1 + s;
    for (let b = 0; b < branches; b++) {
      let x = 8 + ((rnd() - 0.5) * (2 + s * 1.6)) | 0;
      let y = 8 + ((rnd() - 0.5) * (2 + s * 1.6)) | 0;
      const steps = 3 + s * 2;
      for (let i = 0; i < steps; i++) {
        p(x, y, 12, 12, 12, 0.85);
        if (rnd() < 0.4) p(x + 1, y, 30, 30, 30, 0.5);
        x += (rnd() * 3 - 1) | 0;
        y += (rnd() * 3 - 1) | 0;
        if (x < 0 || x > 15 || y < 0 || y > 15) break;
      }
    }
  });
}

/* -------------------------------------------------------------------------
   Atlas assembly
   ---------------------------------------------------------------------- */

export const TILE_INDEX = new Map();
names.forEach((n, i) => TILE_INDEX.set(n, i));

export function tileIndex(name) {
  const i = TILE_INDEX.get(name);
  return i === undefined ? 0 : i;
}

// [u0, v0, u1, v1] for a tile, inset by half a texel so neighbouring tiles
// never bleed in at grazing angles.
export function tileUV(index) {
  const col = index % COLS, row = (index / COLS) | 0;
  const inset = 0.02 / COLS;
  const u0 = col / COLS + inset, v0 = row / COLS + inset;
  return [u0, v0, (col + 1) / COLS - inset, (row + 1) / COLS - inset];
}

let atlasCanvas = null;

// The atlas is built once and shared by the renderer and the inventory icons.
export function getAtlasCanvas() {
  return atlasCanvas || (atlasCanvas = buildAtlas());
}

export function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  names.forEach((name, i) => {
    const ox = (i % COLS) * TILE, oy = ((i / COLS) | 0) * TILE;
    let seed = 0;
    for (let c = 0; c < name.length; c++) seed = (Math.imul(seed, 31) + name.charCodeAt(c)) | 0;
    painters.get(name)(makeTools(ctx, ox, oy, seed >>> 0));
  });
  return canvas;
}

// A soft, tiling cloud layer. Separate texture, drawn as one big quad overhead.
export function buildCloudTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rnd = mulberry32(90210);
  const img = ctx.createImageData(size, size);
  const field = new Float32Array(size * size);
  // A few passes of blurred blobs make convincing, seamless puffs.
  for (let i = 0; i < 90; i++) {
    const cx = rnd() * size, cy = rnd() * size, r = 6 + rnd() * 16;
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y);
        if (d > r) continue;
        const px = (((cx + x) | 0) + size) % size, py = (((cy + y) | 0) + size) % size;
        field[py * size + px] += (1 - d / r) * 0.5;
      }
    }
  }
  for (let i = 0; i < size * size; i++) {
    const a = Math.max(0, Math.min(1, (field[i] - 0.45) * 1.6));
    img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = (a * 220) | 0;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
