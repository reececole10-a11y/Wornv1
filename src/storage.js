// ---------------------------------------------------------------------------
// storage.js - the world lives in localStorage: a seed, the player, and the
// list of blocks that have been changed since generation.
// ---------------------------------------------------------------------------

const SAVE_KEY = 'cubeland.save.v1';
const SETTINGS_KEY = 'cubeland.settings.v1';

export function saveGame(world, player, extra = {}) {
  try {
    const edits = [];
    for (const [key, map] of world.edits) {
      const flat = [];
      for (const [i, id] of map) flat.push(i, id);
      if (flat.length) edits.push([key, flat]);
    }
    const data = {
      seed: world.seed,
      time: world.time,
      edits,
      player: {
        x: player.x, y: player.y, z: player.z,
        yaw: player.yaw, pitch: player.pitch,
        health: player.health, flying: player.flying, creative: player.creative,
        hotbar: player.hotbar, slot: player.slot,
        inventory: [...player.inventory],
        spawn: player.spawn,
      },
      ...extra,
      savedAt: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('save failed', err);
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* storage blocked */ }
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* full or blocked */ }
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function restoreEdits(world, edits) {
  if (!edits) return;
  for (const [key, flat] of edits) {
    const map = new Map();
    for (let i = 0; i < flat.length; i += 2) map.set(flat[i], flat[i + 1]);
    world.edits.set(key, map);
  }
}
