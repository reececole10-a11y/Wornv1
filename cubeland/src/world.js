// ---------------------------------------------------------------------------
// world.js - chunk storage and terrain generation.
//
// The world is an endless grid of 16 x 80 x 16 chunks, generated on demand
// around the player from a single seed. Player edits are kept separately so a
// chunk can be thrown away and rebuilt from noise at any time.
// ---------------------------------------------------------------------------

import { Perlin, hash2, hash3 } from './noise.js';
import * as B from './blocks.js';

export const CHUNK_X = 16;
export const CHUNK_Z = 16;
export const WORLD_H = 80;
export const SECTION_H = 16;
export const SECTIONS = WORLD_H / SECTION_H;
export const SEA_LEVEL = 34;

export const chunkKey = (cx, cz) => cx + ',' + cz;
const idx = (x, y, z) => x + z * CHUNK_X + y * CHUNK_X * CHUNK_Z;

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_X * CHUNK_Z * WORLD_H);
    this.height = new Uint8Array(CHUNK_X * CHUNK_Z); // topmost light-blocking block
    this.generated = false;
  }

  get(x, y, z) {
    if (y < 0 || y >= WORLD_H) return 0;
    return this.blocks[idx(x, y, z)];
  }

  set(x, y, z, id) {
    if (y < 0 || y >= WORLD_H) return;
    this.blocks[idx(x, y, z)] = id;
  }

  recomputeHeight() {
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        let h = 0;
        for (let y = WORLD_H - 1; y >= 0; y--) {
          const b = this.blocks[idx(x, y, z)];
          if (b !== 0 && B.isOpaque(b)) { h = y + 1; break; }
        }
        this.height[x + z * CHUNK_X] = h;
      }
    }
  }
}

export class World {
  constructor(seed = 1337) {
    this.seed = seed | 0;
    this.perlin = new Perlin(this.seed);
    this.chunks = new Map();
    this.edits = new Map();        // chunkKey -> Map(blockIndex -> id)
    this.dirtySections = new Set();// "cx,sy,cz" queued for re-meshing
    this.lights = new Map();       // "x,y,z" -> {x,y,z,strength} for glowing blocks
    this.time = 0.28;              // 0..1 through the day; 0.25 is mid-morning
  }

  /* ---------------------------------------------------------------- terrain */

  heightAt(x, z) {
    const n = this.perlin;
    const cont = n.fbm2(x * 0.0032, z * 0.0032, 4);
    const hill = n.fbm2(x * 0.013 + 100, z * 0.013 - 40, 4);
    const rough = n.fbm2(x * 0.06, z * 0.06, 2);
    const peak = Math.max(0, cont - 0.25) * 1.6;
    let h = SEA_LEVEL + 3 + cont * 10 + hill * 6 * (0.4 + 0.6 * (cont * 0.5 + 0.5))
          + rough * 1.5 + peak * peak * 18;
    if (h < 4) h = 4;
    if (h > WORLD_H - 10) h = WORLD_H - 10;
    return Math.floor(h);
  }

  biomeAt(x, z, h) {
    const n = this.perlin;
    const temp = n.fbm2(x * 0.0018 + 500, z * 0.0018 + 500, 3);
    const moist = n.fbm2(x * 0.0021 - 300, z * 0.0021 + 900, 3);
    if (h > 58 || temp < -0.32) return 'snow';
    if (temp > 0.22 && moist < 0.02) return 'desert';
    if (moist > 0.12) return 'forest';
    return 'plains';
  }

  isCave(x, y, z, h) {
    if (y < 3 || y > h - 3) return false;
    const n = this.perlin;
    const a = n.noise3(x * 0.026, y * 0.05, z * 0.026);
    const b = n.noise3(x * 0.026 + 70, y * 0.05 + 40, z * 0.026 + 11);
    if (a * a + b * b < 0.0042) return true;
    // The odd big cavern, deep down.
    if (y < 30 && n.fbm3(x * 0.035, y * 0.06, z * 0.035, 3) > 0.44) return true;
    return false;
  }

  oreAt(x, y, z, h) {
    const n = this.perlin;
    if (y < 20 && n.noise3(x * 0.12 + 9, y * 0.12, z * 0.12 + 4) > 0.58) return B.GOLD_ORE;
    if (y < 44 && n.noise3(x * 0.11 + 3, y * 0.11 + 7, z * 0.11) > 0.5) return B.IRON_ORE;
    if (y < h - 5 && n.noise3(x * 0.1, y * 0.1 + 31, z * 0.1 + 17) > 0.46) return B.COAL_ORE;
    return 0;
  }

  generateChunk(cx, cz) {
    const chunk = new Chunk(cx, cz);
    const baseX = cx * CHUNK_X, baseZ = cz * CHUNK_Z;
    const blocks = chunk.blocks;

    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        const wx = baseX + x, wz = baseZ + z;
        const h = this.heightAt(wx, wz);
        const biome = this.biomeAt(wx, wz, h);
        const beach = h <= SEA_LEVEL + 1;

        for (let y = 0; y <= h; y++) {
          let id = B.STONE;
          const depth = h - y;

          if (y === 0 || (y < 3 && hash3(this.seed, wx, y, wz) < 0.55)) {
            id = B.BEDROCK;
          } else if (this.isCave(wx, y, wz, h)) {
            continue;                                   // carved out
          } else if (biome === 'desert') {
            id = depth < 4 ? B.SAND : depth < 7 ? B.SANDSTONE : B.STONE;
          } else if (beach && depth < 3) {
            id = hash2(this.seed + 9, wx, wz) < 0.2 ? B.GRAVEL : B.SAND;
          } else if (depth === 0) {
            id = biome === 'snow' ? B.SNOW : B.GRASS;
          } else if (depth < 4) {
            id = B.DIRT;
          } else {
            id = this.oreAt(wx, y, wz, h) || B.STONE;
          }
          blocks[idx(x, y, z)] = id;
        }

        // Oceans, lakes and the odd flooded cave mouth.
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          if (blocks[idx(x, y, z)] === 0) blocks[idx(x, y, z)] = B.WATER;
        }

        // Ground cover.
        const top = blocks[idx(x, h, z)];
        if (h > SEA_LEVEL && blocks[idx(x, h + 1, z)] === 0) {
          const r = hash2(this.seed + 3, wx, wz);
          if (top === B.GRASS) {
            if (r < 0.10) blocks[idx(x, h + 1, z)] = B.TALL_GRASS;
            else if (r < 0.115) blocks[idx(x, h + 1, z)] = B.FLOWER_RED;
            else if (r < 0.13) blocks[idx(x, h + 1, z)] = B.FLOWER_YEL;
          } else if (top === B.SAND && biome === 'desert' && r < 0.012) {
            const tall = 1 + ((r * 400) % 3 | 0);
            for (let k = 1; k <= tall && h + k < WORLD_H; k++) blocks[idx(x, h + k, z)] = B.CACTUS;
          }
        }
      }
    }

    this.plantTrees(chunk);
    this.applyEdits(chunk);
    chunk.recomputeHeight();
    chunk.generated = true;
    this.chunks.set(chunkKey(cx, cz), chunk);
    this.indexLights(chunk);
    return chunk;
  }

  // Trees live on a jittered grid so they never bunch up, and each candidate is
  // checked against every chunk it could overhang.
  plantTrees(chunk) {
    const CELL = 5;
    const baseX = chunk.cx * CHUNK_X, baseZ = chunk.cz * CHUNK_Z;
    const c0x = Math.floor((baseX - 3) / CELL), c1x = Math.floor((baseX + CHUNK_X + 3) / CELL);
    const c0z = Math.floor((baseZ - 3) / CELL), c1z = Math.floor((baseZ + CHUNK_Z + 3) / CELL);

    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const r = hash2(this.seed + 77, cx, cz);
        const wx = cx * CELL + ((hash2(this.seed + 12, cx, cz) * CELL) | 0);
        const wz = cz * CELL + ((hash2(this.seed + 34, cz, cx) * CELL) | 0);
        const h = this.heightAt(wx, wz);
        if (h <= SEA_LEVEL + 1) continue;
        const biome = this.biomeAt(wx, wz, h);
        const density = biome === 'forest' ? 0.62 : biome === 'plains' ? 0.10 : biome === 'snow' ? 0.18 : 0;
        if (r > density) continue;
        if (this.isCave(wx, h, wz, h)) continue;
        this.placeTree(chunk, wx, h + 1, wz, biome, hash2(this.seed + 55, wx, wz));
      }
    }
  }

  placeTree(chunk, wx, wy, wz, biome, r) {
    const tall = biome === 'snow';
    const trunk = (tall ? 6 : 4) + ((r * 3) | 0);
    const put = (x, y, z, id, soft) => {
      const lx = x - chunk.cx * CHUNK_X, lz = z - chunk.cz * CHUNK_Z;
      if (lx < 0 || lz < 0 || lx >= CHUNK_X || lz >= CHUNK_Z || y < 0 || y >= WORLD_H) return;
      const cur = chunk.blocks[idx(lx, y, lz)];
      if (soft && cur !== 0 && cur !== B.LEAVES) return;
      if (!soft && cur !== 0 && cur !== B.LEAVES && cur !== B.TALL_GRASS) return;
      chunk.blocks[idx(lx, y, lz)] = id;
    };

    for (let i = 0; i < trunk; i++) put(wx, wy + i, wz, B.LOG, false);

    const topY = wy + trunk;
    if (tall) {
      // Narrow conifer: a few tapering skirts of leaves.
      for (let layer = 0; layer < 4; layer++) {
        const y = topY - layer - 1;
        const rad = layer === 0 ? 1 : layer < 3 ? 2 : 1;
        for (let dz = -rad; dz <= rad; dz++) {
          for (let dx = -rad; dx <= rad; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > rad + 1) continue;
            if (dx === 0 && dz === 0 && y < topY) continue;
            put(wx + dx, y, wz + dz, B.LEAVES, true);
          }
        }
      }
      put(wx, topY, wz, B.LEAVES, true);
    } else {
      // Round oak canopy with the corners chewed off.
      for (let dy = -2; dy <= 1; dy++) {
        const y = topY + dy;
        const rad = dy <= -1 ? 2 : 1;
        for (let dz = -rad; dz <= rad; dz++) {
          for (let dx = -rad; dx <= rad; dx++) {
            if (Math.abs(dx) === rad && Math.abs(dz) === rad && hash3(this.seed, wx + dx, y, wz + dz) < 0.6) continue;
            if (dx === 0 && dz === 0 && dy < 0) continue;
            put(wx + dx, y, wz + dz, B.LEAVES, true);
          }
        }
      }
    }
  }

  /* ------------------------------------------------------------ block access */

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  ensureChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz)) || this.generateChunk(cx, cz);
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= WORLD_H) return 0;
    const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return 0;
    return chunk.blocks[idx(x - cx * CHUNK_X, y, z - cz * CHUNK_Z)];
  }

  // Topmost light-blocking block in a column; used for the cheap sky lighting.
  heightOf(x, z) {
    const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return 0;
    return chunk.height[(x - cx * CHUNK_X) + (z - cz * CHUNK_Z) * CHUNK_X];
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= WORLD_H) return false;
    const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return false;
    const lx = x - cx * CHUNK_X, lz = z - cz * CHUNK_Z;
    const before = chunk.blocks[idx(lx, y, lz)];
    if (before === id) return false;
    chunk.blocks[idx(lx, y, lz)] = id;

    // Remember the edit so the chunk can be regenerated and still look right.
    const key = chunkKey(cx, cz);
    let m = this.edits.get(key);
    if (!m) this.edits.set(key, (m = new Map()));
    m.set(idx(lx, y, lz), id);

    // Keep the column height and the light list current. Only a change in
    // column height needs the whole column relit.
    const hi = lx + lz * CHUNK_X;
    const wasHeight = chunk.height[hi];
    if (B.isOpaque(id) && y + 1 > wasHeight) chunk.height[hi] = y + 1;
    else if (!B.isOpaque(id) && y + 1 === wasHeight) {
      let h = 0;
      for (let yy = y; yy >= 0; yy--) {
        const b = chunk.blocks[idx(lx, yy, lz)];
        if (b !== 0 && B.isOpaque(b)) { h = yy + 1; break; }
      }
      chunk.height[hi] = h;
    }
    const heightChanged = chunk.height[hi] !== wasHeight;
    const lk = x + ',' + y + ',' + z;
    const lightStrength = B.blockDef(id) ? B.blockDef(id).light : 0;
    if (lightStrength > 0) this.lights.set(lk, { x: x + 0.5, y: y + 0.5, z: z + 0.5, strength: lightStrength });
    else this.lights.delete(lk);

    this.markDirty(x, y, z, heightChanged);
    return true;
  }

  markDirty(x, y, z, relightColumn = true) {
    const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
    const sy = Math.floor(y / SECTION_H);
    const lx = x - cx * CHUNK_X, lz = z - cz * CHUNK_Z, ly = y - sy * SECTION_H;
    this.dirtySections.add(cx + ',' + sy + ',' + cz);
    // A block on a boundary changes the face culling of its neighbour, too.
    if (lx === 0) this.dirtySections.add((cx - 1) + ',' + sy + ',' + cz);
    if (lx === CHUNK_X - 1) this.dirtySections.add((cx + 1) + ',' + sy + ',' + cz);
    if (lz === 0) this.dirtySections.add(cx + ',' + sy + ',' + (cz - 1));
    if (lz === CHUNK_Z - 1) this.dirtySections.add(cx + ',' + sy + ',' + (cz + 1));
    if (ly === 0 && sy > 0) this.dirtySections.add(cx + ',' + (sy - 1) + ',' + cz);
    if (ly === SECTION_H - 1 && sy < SECTIONS - 1) this.dirtySections.add(cx + ',' + (sy + 1) + ',' + cz);
    // Sky light is worked out per column, so a change in surface height means
    // everything under it has to be rebuilt.
    if (relightColumn) {
      for (let s = 0; s < SECTIONS; s++) this.dirtySections.add(cx + ',' + s + ',' + cz);
    }
  }

  applyEdits(chunk) {
    const m = this.edits.get(chunkKey(chunk.cx, chunk.cz));
    if (!m) return;
    for (const [i, id] of m) chunk.blocks[i] = id;
  }

  indexLights(chunk) {
    const baseX = chunk.cx * CHUNK_X, baseZ = chunk.cz * CHUNK_Z;
    for (let y = 0; y < WORLD_H; y++) {
      for (let z = 0; z < CHUNK_Z; z++) {
        for (let x = 0; x < CHUNK_X; x++) {
          const id = chunk.blocks[idx(x, y, z)];
          if (id === 0) continue;
          const d = B.blockDef(id);
          if (d && d.light > 0) {
            this.lights.set((baseX + x) + ',' + y + ',' + (baseZ + z),
              { x: baseX + x + 0.5, y: y + 0.5, z: baseZ + z + 0.5, strength: d.light });
          }
        }
      }
    }
  }

  unloadChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    const baseX = cx * CHUNK_X, baseZ = cz * CHUNK_Z;
    for (const k of this.lights.keys()) {
      const [lx, , lz] = k.split(',').map(Number);
      if (lx >= baseX && lx < baseX + CHUNK_X && lz >= baseZ && lz < baseZ + CHUNK_Z) this.lights.delete(k);
    }
    this.chunks.delete(key);
  }

  // A safe place to drop the player: the first air gap above the surface.
  spawnPoint(x = 8, z = 8) {
    this.ensureChunk(Math.floor(x / CHUNK_X), Math.floor(z / CHUNK_Z));
    for (let y = WORLD_H - 2; y > 1; y--) {
      if (B.isSolid(this.getBlock(x, y, z)) || this.getBlock(x, y, z) === B.WATER) {
        return [x + 0.5, y + 2.2, z + 0.5];
      }
    }
    return [x + 0.5, SEA_LEVEL + 4, z + 0.5];
  }
}
