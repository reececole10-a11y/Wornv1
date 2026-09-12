// ---------------------------------------------------------------------------
// mesher.js - turns a 16 x 16 x 16 section of blocks into triangles.
//
// Only faces that touch something see-through are emitted, each vertex carries
// ambient occlusion from its three neighbours, and sky light falls off with
// depth below the surface. Solid and water geometry come back separately
// because water has to be drawn last, blended.
// ---------------------------------------------------------------------------

import * as B from './blocks.js';
import { CHUNK_X, CHUNK_Z, SECTION_H, WORLD_H, chunkKey } from './world.js';
import { tileIndex, tileUV } from './textures.js';

// +X, -X, +Y, -Y, +Z, -Z - the same order as the per-face tiles in blocks.js.
const FACES = [
  { n: [1, 0, 0],  v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.72 },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.72 },
  { n: [0, 1, 0],  v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
  { n: [0, 0, 1],  v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.86 },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.86 },
];
// Which atlas corner each of the four vertices takes: [u, v], v=1 is the
// bottom of the tile.
const FACE_UV = [[0, 1], [1, 1], [1, 0], [0, 0]];
const AO_LEVELS = [0.42, 0.62, 0.82, 1.0];

function faceVisible(self, nb) {
  if (nb === 0) return true;
  const nd = B.blockDef(nb);
  if (!nd) return true;
  if (nd.render === 'cross') return true;
  if (nd.opaque) return false;
  // Two panes of glass or two water blocks hide the face between them.
  if (nb === self) return false;
  return true;
}

class MeshBuffer {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.light = [];
    this.normal = [];
    this.index = [];
    this.verts = 0;
  }
  quad(v, uv, sky, block, n) {
    const base = this.verts;
    for (let i = 0; i < 4; i++) {
      this.pos.push(v[i][0], v[i][1], v[i][2]);
      this.uv.push(uv[i][0], uv[i][1]);
      this.light.push(sky[i], block[i]);
      this.normal.push(n[0], n[1], n[2]);
    }
    this.verts += 4;
    // Flip the split so the ambient occlusion gradient does not crease.
    if (sky[0] + sky[2] > sky[1] + sky[3]) {
      this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      this.index.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    }
  }
  finish() {
    if (!this.verts) return null;
    return {
      pos: new Float32Array(this.pos),
      uv: new Float32Array(this.uv),
      light: new Float32Array(this.light),
      normal: new Float32Array(this.normal),
      index: this.index,
      count: this.index.length,
    };
  }
}

export function buildSectionMesh(world, cx, sy, cz) {
  const solid = new MeshBuffer();
  const water = new MeshBuffer();
  const baseX = cx * CHUNK_X, baseY = sy * SECTION_H, baseZ = cz * CHUNK_Z;

  // Cache the 3 x 3 chunk neighbourhood so sampling never hits the map.
  const near = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      near[(dz + 1) * 3 + (dx + 1)] = world.chunks.get(chunkKey(cx + dx, cz + dz)) || null;
    }
  }
  const sample = (x, y, z) => {
    if (y < 0 || y >= WORLD_H) return 0;
    const gx = x - baseX, gz = z - baseZ;
    const dx = gx < 0 ? -1 : gx >= CHUNK_X ? 1 : 0;
    const dz = gz < 0 ? -1 : gz >= CHUNK_Z ? 1 : 0;
    const c = near[(dz + 1) * 3 + (dx + 1)];
    if (!c) return 0;
    const lx = x - (cx + dx) * CHUNK_X, lz = z - (cz + dz) * CHUNK_Z;
    return c.blocks[lx + lz * CHUNK_X + y * CHUNK_X * CHUNK_Z];
  };
  const occludes = (x, y, z) => {
    const b = sample(x, y, z);
    return b !== 0 && B.isOpaque(b);
  };
  // Sky light: full daylight at or above the surface, fading with depth.
  const skyAt = (x, y, z) => {
    const gx = x - baseX, gz = z - baseZ;
    const dx = gx < 0 ? -1 : gx >= CHUNK_X ? 1 : 0;
    const dz = gz < 0 ? -1 : gz >= CHUNK_Z ? 1 : 0;
    const c = near[(dz + 1) * 3 + (dx + 1)];
    if (!c) return 1;
    const h = c.height[(x - (cx + dx) * CHUNK_X) + (z - (cz + dz) * CHUNK_Z) * CHUNK_X];
    if (y >= h) return 1;
    return Math.max(0.2, 1 - (h - y) * 0.07);
  };

  const chunk = world.chunks.get(chunkKey(cx, cz));
  if (!chunk) return { solid: null, water: null };

  for (let y = baseY; y < baseY + SECTION_H; y++) {
    for (let z = baseZ; z < baseZ + CHUNK_Z; z++) {
      for (let x = baseX; x < baseX + CHUNK_X; x++) {
        const id = chunk.blocks[(x - baseX) + (z - baseZ) * CHUNK_X + y * CHUNK_X * CHUNK_Z];
        if (id === 0) continue;
        const def = B.blockDef(id);
        if (!def) continue;

        if (def.render === 'cross') {
          emitCross(solid, x, y, z, def, skyAt(x, y, z));
          continue;
        }

        const target = def.liquid ? water : solid;
        const emissive = def.light;
        const topOpen = def.liquid && sample(x, y + 1, z) !== id;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = x + face.n[0], ny = y + face.n[1], nz = z + face.n[2];
          const nb = sample(nx, ny, nz);
          if (!faceVisible(id, nb)) continue;
          if (def.liquid && f === 3 && nb !== 0 && !B.blockDef(nb).liquid) continue;

          const [u0, v0, u1, v1] = tileUV(tileIndex(def.tiles[f]));
          const sky = [], blk = [], verts = [];
          const skyBase = skyAt(nx, ny, nz) * face.shade;

          for (let i = 0; i < 4; i++) {
            const c = face.v[i];
            let vx = x + c[0], vy = y + c[1], vz = z + c[2];
            // Water sits a little below a full block, like a real surface.
            if (def.liquid && c[1] === 1 && topOpen) vy = y + 0.875;
            verts.push([vx, vy, vz]);
            const ao = def.liquid ? 1 : vertexAO(occludes, x, y, z, face.n, c);
            sky.push(skyBase * ao);
            blk.push(emissive > 0 ? emissive : 0);
          }

          const uv = FACE_UV.map(([a, b]) => [a ? u1 : u0, b ? v1 : v0]);
          target.quad(verts, uv, sky, blk, face.n);
        }
      }
    }
  }

  return { solid: solid.finish(), water: water.finish() };
}

// Classic three-sample ambient occlusion: darken a corner by how many of the
// three blocks around it are solid.
function vertexAO(occludes, x, y, z, n, corner) {
  // Work out the two axes that lie in the face plane.
  const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
  const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
  const s1 = corner[a1] === 1 ? 1 : -1;
  const s2 = corner[a2] === 1 ? 1 : -1;

  const base = [x + n[0], y + n[1], z + n[2]];
  const off = (d1, d2) => {
    const p = [base[0], base[1], base[2]];
    p[a1] += d1; p[a2] += d2;
    return occludes(p[0], p[1], p[2]) ? 1 : 0;
  };
  const side1 = off(s1, 0), side2 = off(0, s2);
  if (side1 && side2) return AO_LEVELS[0];
  return AO_LEVELS[3 - (side1 + side2 + off(s1, s2))];
}

// Grass and flowers: two quads in an X, visible from both sides.
function emitCross(buf, x, y, z, def, sky) {
  const [u0, v0, u1, v1] = tileUV(tileIndex(def.tiles[0]));
  const uv = FACE_UV.map(([a, b]) => [a ? u1 : u0, b ? v1 : v0]);
  const light = [sky, sky, sky, sky];
  const zero = [0, 0, 0, 0];
  const k = 0.15;                      // inset so the X fits inside the block
  const planes = [
    [[x + k, y, z + k], [x + 1 - k, y, z + 1 - k], [x + 1 - k, y + 1, z + 1 - k], [x + k, y + 1, z + k]],
    [[x + 1 - k, y, z + k], [x + k, y, z + 1 - k], [x + k, y + 1, z + 1 - k], [x + 1 - k, y + 1, z + k]],
  ];
  for (const p of planes) {
    buf.quad(p, uv, light, zero, [0, 1, 0]);
    // Same quad wound the other way, so it does not vanish from behind.
    buf.quad([p[3], p[2], p[1], p[0]], [uv[3], uv[2], uv[1], uv[0]], light, zero, [0, 1, 0]);
  }
}
