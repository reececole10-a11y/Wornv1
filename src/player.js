// ---------------------------------------------------------------------------
// player.js - movement, collision, the block raycast, and what happens when
// you break or place something.
// ---------------------------------------------------------------------------

import * as B from './blocks.js';
import { WORLD_H } from './world.js';
import { clamp } from './math.js';

const WIDTH = 0.6;          // the player's box, in blocks
const HEIGHT = 1.8;
const EYE = 1.62;
const GRAVITY = 28;
const JUMP_SPEED = 8.6;
const WALK_SPEED = 4.5;
const SPRINT_SPEED = 6.6;
const FLY_SPEED = 11;
const REACH = 5.5;

export class Player {
  constructor(world, spawn) {
    this.world = world;
    this.x = spawn[0]; this.y = spawn[1]; this.z = spawn[2];
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.headUnderwater = false;
    this.flying = false;
    this.creative = false;
    this.health = 10;
    this.maxHealth = 10;
    this.air = 10;
    this.breath = 10;
    this.damageEnabled = true;
    this.autoJump = true;
    this.spawn = spawn.slice();
    this.bob = 0;
    this.walkTime = 0;
    this.fallStart = this.y;
    this.hurtFlash = 0;
    this.dead = false;

    this.hotbar = [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.LOG, B.SAND, B.GLASS, B.LANTERN];
    this.slot = 0;
    this.inventory = new Map();   // block id -> count
  }

  get eyeY() { return this.y + EYE; }

  camera() {
    const p = this;
    return {
      x: p.x,
      y: p.eyeY + Math.sin(p.bob) * 0.045 * (p.onGround ? 1 : 0),
      z: p.z,
      direction: () => p.direction(),
    };
  }

  direction() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  held() { return this.hotbar[this.slot]; }

  count(id) {
    if (this.creative) return Infinity;
    return this.inventory.get(id) || 0;
  }

  give(id, n = 1) {
    if (!id) return;
    this.inventory.set(id, (this.inventory.get(id) || 0) + n);
  }

  take(id, n = 1) {
    if (this.creative) return true;
    const have = this.inventory.get(id) || 0;
    if (have < n) return false;
    if (have === n) this.inventory.delete(id);
    else this.inventory.set(id, have - n);
    return true;
  }

  /* ----------------------------------------------------------- world queries */

  blockAt(x, y, z) { return this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)); }

  solidAt(x, y, z) { return B.isSolid(this.world.getBlock(x, y, z)); }

  // Does the player's box fit with its feet at (x, y, z)?
  fits(x, y, z) {
    const h = WIDTH / 2;
    for (let bx = Math.floor(x - h); bx <= Math.floor(x + h); bx++) {
      for (let bz = Math.floor(z - h); bz <= Math.floor(z + h); bz++) {
        for (let by = Math.floor(y); by <= Math.floor(y + HEIGHT - 0.01); by++) {
          if (this.solidAt(bx, by, bz)) return false;
        }
      }
    }
    return true;
  }

  /* ------------------------------------------------------------------ update */

  update(dt, input) {
    if (this.dead) return;
    dt = Math.min(dt, 0.05);

    const feet = this.blockAt(this.x, this.y + 0.2, this.z);
    const head = this.blockAt(this.x, this.eyeY, this.z);
    this.inWater = B.isLiquid(feet) || B.isLiquid(head);
    this.headUnderwater = B.isLiquid(head);

    // Direction the sticks/keys are asking for, rotated into world space.
    const fwd = input.forward, side = input.strafe;
    const len = Math.hypot(fwd, side) || 1;
    const nf = fwd / Math.max(1, len), ns = side / Math.max(1, len);
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    const wantX = -sinY * nf + cosY * ns;
    const wantZ = -cosY * nf - sinY * ns;

    let speed = this.flying ? FLY_SPEED : input.sprint ? SPRINT_SPEED : WALK_SPEED;
    if (this.inWater && !this.flying) speed *= 0.62;

    const control = this.flying ? 1 : this.onGround ? 1 : 0.32;
    const targetX = wantX * speed, targetZ = wantZ * speed;
    const blend = 1 - Math.pow(0.0009, dt * (this.onGround || this.flying ? 1 : 0.35));
    this.vx += (targetX - this.vx) * blend * control;
    this.vz += (targetZ - this.vz) * blend * control;

    if (this.flying) {
      const vertical = (input.up ? 1 : 0) - (input.down ? 1 : 0);
      this.vy += (vertical * FLY_SPEED - this.vy) * blend;
    } else if (this.inWater) {
      this.vy -= GRAVITY * 0.28 * dt;
      if (input.jump) this.vy = 4.2;
      this.vy = clamp(this.vy, -4.5, 5);
      this.vy *= 1 - 1.6 * dt;
    } else {
      if (input.jump && this.onGround) {
        this.vy = JUMP_SPEED;
        this.onGround = false;
      }
      this.vy -= GRAVITY * dt;
      if (this.vy < -58) this.vy = -58;
    }

    const wasGround = this.onGround;
    this.onGround = false;
    const blocked = this.move(this.vx * dt, this.vy * dt, this.vz * dt);

    // Step up a single block without the player having to tap jump.
    if (blocked.horizontal && this.autoJump && this.onGround && !this.flying && !this.inWater) {
      if (this.fits(this.x + Math.sign(this.vx) * 0.35, this.y + 1.05, this.z + Math.sign(this.vz) * 0.35)) {
        this.vy = JUMP_SPEED * 0.82;
      }
    }

    // Fall damage, measured from wherever the fall started.
    if (this.onGround && !wasGround) {
      const drop = this.fallStart - this.y;
      if (this.damageEnabled && !this.flying && !this.inWater && drop > 4) {
        this.hurt(Math.floor((drop - 4) * 0.8));
      }
      this.fallStart = this.y;
    }
    if (this.onGround || this.flying || this.inWater || this.y > this.fallStart) this.fallStart = this.y;

    // Drowning, and the breath meter refilling at the surface.
    if (this.headUnderwater) {
      this.breath -= dt;
      if (this.breath <= 0) {
        this.breath = 1;
        if (this.damageEnabled) this.hurt(1);
      }
    } else {
      this.breath = Math.min(10, this.breath + dt * 4);
    }

    if (this.y < -4) {
      if (this.damageEnabled) this.hurt(20); else this.teleportToSpawn();
    }

    const moving = Math.hypot(this.vx, this.vz);
    if (moving > 0.4 && (this.onGround || this.inWater)) {
      this.walkTime += dt * moving * 1.6;
      this.bob = this.walkTime;
    }
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);
  }

  hurt(amount) {
    if (this.creative || this.dead) return;
    this.health -= amount;
    this.hurtFlash = 1;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
    }
  }

  respawn() {
    this.health = this.maxHealth;
    this.breath = 10;
    this.dead = false;
    this.teleportToSpawn();
  }

  teleportToSpawn() {
    const p = this.world.spawnPoint(Math.floor(this.spawn[0]), Math.floor(this.spawn[2]));
    this.x = p[0]; this.y = p[1]; this.z = p[2];
    this.vx = this.vy = this.vz = 0;
    this.fallStart = this.y;
  }

  // Move in small steps, resolving one axis at a time so sliding along walls
  // feels right.
  move(dx, dy, dz) {
    const result = { horizontal: false, vertical: false };
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.2) || 1;
    const sx = dx / steps, sy = dy / steps, sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      if (this.axis(0, sx)) { result.horizontal = true; this.vx = 0; }
      if (this.axis(1, sy)) { result.vertical = true; if (sy < 0) this.onGround = true; this.vy = 0; }
      if (this.axis(2, sz)) { result.horizontal = true; this.vz = 0; }
    }
    return result;
  }

  axis(axis, delta) {
    if (delta === 0) return false;
    if (axis === 0) this.x += delta;
    else if (axis === 1) this.y += delta;
    else this.z += delta;

    const h = WIDTH / 2 - 0.001;
    const minX = Math.floor(this.x - h), maxX = Math.floor(this.x + h);
    const minY = Math.floor(this.y), maxY = Math.floor(this.y + HEIGHT - 0.001);
    const minZ = Math.floor(this.z - h), maxZ = Math.floor(this.z + h);

    let hit = false;
    for (let bx = minX; bx <= maxX; bx++) {
      for (let by = minY; by <= maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          if (!this.solidAt(bx, by, bz)) continue;
          hit = true;
          if (axis === 0) this.x = delta > 0 ? bx - h - 0.0001 : bx + 1 + h + 0.0001;
          else if (axis === 1) this.y = delta > 0 ? by - HEIGHT - 0.0001 : by + 1 + 0.0001;
          else this.z = delta > 0 ? bz - h - 0.0001 : bz + 1 + h + 0.0001;
        }
      }
    }
    return hit;
  }

  /* --------------------------------------------------------------- targeting */

  // Amanatides & Woo voxel traversal: walk the ray cell by cell.
  raycast(maxDist = REACH) {
    const [dx, dy, dz] = this.direction();
    const cam = this.camera();
    let x = Math.floor(cam.x), y = Math.floor(cam.y), z = Math.floor(cam.z);
    const stepX = Math.sign(dx), stepY = Math.sign(dy), stepZ = Math.sign(dz);
    const tDeltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
    const tDeltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
    const tDeltaZ = dz === 0 ? Infinity : Math.abs(1 / dz);
    const boundary = (p, step) => (step > 0 ? Math.floor(p) + 1 - p : p - Math.floor(p));
    let tMaxX = dx === 0 ? Infinity : boundary(cam.x, stepX) * tDeltaX;
    let tMaxY = dy === 0 ? Infinity : boundary(cam.y, stepY) * tDeltaY;
    let tMaxZ = dz === 0 ? Infinity : boundary(cam.z, stepZ) * tDeltaZ;
    let face = [0, 0, 0];
    let t = 0;

    while (t <= maxDist) {
      if (y >= 0 && y < WORLD_H) {
        const id = this.world.getBlock(x, y, z);
        if (id !== 0 && !B.isLiquid(id)) {
          return { x, y, z, id, nx: face[0], ny: face[1], nz: face[2], dist: t };
        }
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0];
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0];
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ];
      }
    }
    return null;
  }

  breakBlock(hit) {
    const def = B.blockDef(hit.id);
    if (!def || def.hardness === Infinity) return false;
    this.world.setBlock(hit.x, hit.y, hit.z, 0);
    // Anything resting on top (grass, flowers) falls with it.
    const above = this.world.getBlock(hit.x, hit.y + 1, hit.z);
    if (B.isCross(above)) this.world.setBlock(hit.x, hit.y + 1, hit.z, 0);
    if (!this.creative && def.drop) this.give(def.drop, 1);
    return true;
  }

  placeBlock(hit, id) {
    if (!id) return false;
    const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
    if (y < 0 || y >= WORLD_H) return false;
    const existing = this.world.getBlock(x, y, z);
    if (existing !== 0 && !B.isLiquid(existing) && !B.isCross(existing)) return false;
    // Never seal yourself inside a block.
    if (B.isSolid(id)) {
      const h = WIDTH / 2;
      const overlaps = x + 1 > this.x - h && x < this.x + h &&
                       z + 1 > this.z - h && z < this.z + h &&
                       y + 1 > this.y && y < this.y + HEIGHT;
      if (overlaps) return false;
    }
    if (!this.take(id, 1)) return false;
    this.world.setBlock(x, y, z, id);
    return true;
  }

  // Seconds needed to break a block; ore and stone go faster if you are holding
  // something harder than your hand.
  breakTime(id) {
    const def = B.blockDef(id);
    if (!def) return 0;
    if (this.creative) return 0.06;
    if (def.hardness === Infinity) return Infinity;
    return Math.max(0.08, def.hardness * 0.85);
  }
}
