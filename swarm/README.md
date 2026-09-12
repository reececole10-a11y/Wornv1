# Swarm

A one-thumb survival arena. You move; the weapons aim and fire themselves. The
horde gets bigger every second, and every level you choose one thing that gets
stronger. See how long you last.

Canvas 2D, about 1,400 lines, no engine, no dependencies, no art or audio
files — the sounds are synthesised on the fly.

---

## Playing

Touch and hold anywhere: a stick appears under your thumb and the ship follows
it. That is the whole control scheme. On a computer, WASD or the arrow keys.

- **Green gems** are experience. Anything you leave behind drifts over to you
  after a few seconds, so kiting never costs you a level.
- **Red crosses** heal 22. Uncommon from ordinary enemies, guaranteed from a
  boss.
- Every two minutes something big arrives. It is worth killing.

## The weapons

You start with **Bolt** and can carry five at once. Each levels up six times.

| | |
|---|---|
| **Bolt** | Fires at the nearest enemy. Gains extra shots and, late, pierce. |
| **Shards** | Crystals orbit you and cut anything they touch. Good while running. |
| **Pulse** | A shockwave that damages and knocks back everything around you. |
| **Arc** | Lightning that jumps between bodies — the more crowded, the better. |
| **Lance** | A heavy spear fired along your movement, straight through a line of them. |
| **Motes** | Homing sparks that hunt on their own. |

Passives — Power, Haste, Swift, Vigor, Magnet, Regen, Armour — stack up to
four or five times each.

## The enemies

Grunts from the start, then fast **swarmers** at 45s, armoured **brutes** at
95s, ranged **spitters** at 150s that hold their distance and shoot, and
**splitters** at 215s that burst into a pack when they die. Health and speed
scale with the clock; the field caps at 340 bodies so the frame rate holds.

---

## How it works

```
src/main.js     Boot, frame loop, buttons
src/game.js     Simulation and renderer - entities, spawning, drawing
src/weapons.js  The six weapons and the passive upgrades
src/fx.js       Particles, floating numbers, screen shake, glow sprites
src/input.js    Thumbstick and keyboard
src/ui.js       Bars, level-up cards, run summary, best run
src/audio.js    Synthesised sound
```

Enemies live in a uniform grid rebuilt each frame, so bullets, orbits and
shockwaves only test what is nearby — the sim stays around a millisecond a
frame with 340 enemies on screen. Everything glows by drawing one cached
radial-gradient sprite in `lighter` blend mode under a flat shape, which is far
cheaper than per-draw `shadowBlur`.

Your best run is kept in `localStorage`. Losing focus pauses the game rather
than letting the swarm eat you while you are in another tab.
