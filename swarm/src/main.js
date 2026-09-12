// ---------------------------------------------------------------------------
// main.js - boot, the frame loop, and the buttons.
// ---------------------------------------------------------------------------

import { Game } from './game.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';

const canvas = document.getElementById('game');
const input = new Input(canvas);
const sound = new Sound();
const ui = new UI();
const game = new Game(canvas, input, sound, ui);

let running = false;
let last = performance.now();

window.addEventListener('resize', () => game.resize());
window.addEventListener('orientationchange', () => setTimeout(() => game.resize(), 250));

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (running) game.update(dt);
  game.draw();
  ui.update(game);
}

function startRun() {
  game.reset();
  ui.lastLoadout = '';
  document.getElementById('over').hidden = true;
  document.getElementById('levelup').hidden = true;
  document.getElementById('pause').hidden = true;
  document.getElementById('title').hidden = true;
  running = true;
  last = performance.now();
  sound.start();
}

document.getElementById('btn-play').addEventListener('click', startRun);
document.getElementById('btn-again').addEventListener('click', startRun);

document.getElementById('btn-pause').addEventListener('click', () => {
  if (game.over || !running) return;
  game.paused = true;
  document.getElementById('pause').hidden = false;
});
document.getElementById('btn-resume').addEventListener('click', () => {
  document.getElementById('pause').hidden = true;
  if (document.getElementById('levelup').hidden) game.paused = false;
});
document.getElementById('btn-quit').addEventListener('click', () => {
  document.getElementById('pause').hidden = true;
  game.paused = false;
  game.hurtPlayer(99999);
});
document.getElementById('sound').addEventListener('change', (e) => {
  sound.enabled = e.target.checked;
  if (e.target.checked) sound.start();
});

// Losing focus mid-run pauses rather than letting the swarm eat you offscreen.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running && !game.over) {
    game.paused = true;
    document.getElementById('pause').hidden = false;
  }
});

window.swarm = game;
requestAnimationFrame(frame);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
