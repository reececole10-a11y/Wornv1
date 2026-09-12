# Cubeland

A block-building sandbox that runs in a phone browser. Mine, build, and wander
an endless procedurally generated world — the kind of game Minecraft made a
genre out of, written from scratch in about 3,500 lines of JavaScript with no
engine, no framework and no asset files.

Open it on a phone, tap **Play**, and you are standing in a world nobody has
seen before.

---

## Playing it

**On a phone**

| | |
|---|---|
| Walk | Left thumb, anywhere on the left of the screen — a stick appears where you touch |
| Sprint | Push the stick all the way out |
| Look | Drag anywhere on the right |
| Place a block | Tap the right side, or the **PLACE** button |
| Mine a block | Press and hold, or hold **MINE** |
| Jump | **JUMP** |
| Fly | Double-tap **JUMP**, then use the ▲ ▼ buttons |
| Change block | Tap a hotbar slot; **hold** a slot to open the block picker |
| Everything else | The **☰** menu |

**On a computer**

`WASD` to move, mouse to look (click the canvas to capture the pointer),
left click mines, right click places, `Space` jumps, `Shift` sprints,
`1`–`9` pick a hotbar slot, `E` opens the inventory, `F` toggles flight,
`Esc` opens the menu.

### What is in the world

Grass plains, forests, deserts with cactus, snowy highlands, oceans and lakes,
caves that wind down to bedrock, and coal, iron and gold in the stone. Trees
grow, flowers dot the grass, the sun crosses the sky on a ten minute cycle and
the stars come out at night.

You start in survival: mined blocks go into your inventory, placed blocks come
back out of it, and you can craft a few things (logs into planks, cobble into
stone bricks, sand into glass, glass and coal into lanterns). Falling hurts,
and staying underwater drowns you. If you would rather just build, turn on
**Creative mode** in the menu — infinite blocks, no damage.

Lanterns and glowstone cast real light, which is what you want when you are
twenty blocks underground. The **Miner's light** setting gives you a faint glow
of your own if you would rather not carry a light source everywhere.

Your world saves itself to the browser every thirty seconds and when you leave
the page.

---

## Running it

It is a static site with no build step and no dependencies. Any web server
will do:

```bash
python3 -m http.server 8000
# or: npx http-server -p 8000
```

Then open `http://localhost:8000`. (Opening `index.html` straight off disk
will not work — ES modules need to be served over HTTP.)

### Putting it online

Push the repository to GitHub and turn on **Pages** (Settings → Pages → deploy
from branch), or drop the folder into Netlify or Vercel. There is no backend,
so any static host works.

### Installing it on a phone

Open the deployed URL, then **Share → Add to Home Screen** on iOS, or
**Install app** in Chrome on Android. It launches fullscreen, and a service
worker keeps it playable with no signal.

---

## How it works

```
index.html          Document shell, HUD markup, panels
styles.css          Touch-first UI, safe-area aware
src/main.js         Frame loop, chunk streaming, day/night, wiring
src/world.js        Chunk storage and terrain generation
src/mesher.js       Blocks -> triangles, with ambient occlusion
src/renderer.js     WebGL: terrain, sky, clouds, selection, held block
src/player.js       Movement, collision, raycasting, break and place
src/input.js        Touch sticks and taps, keyboard, pointer lock
src/ui.js           Hotbar, inventory, crafting, vitals
src/textures.js     Every texture, drawn pixel by pixel into one atlas
src/audio.js        Every sound, synthesised with the Web Audio API
src/noise.js        Seeded Perlin noise and hashes
src/math.js         Matrices and frustum planes
src/storage.js      Save and load
sw.js               Offline cache
```

A few decisions worth knowing about if you want to change something:

**The world is 16 x 80 x 16 chunks**, generated on demand around you from a
single seed and thrown away behind you. Nothing is stored except the blocks
*you* changed, so a save file stays small no matter how far you walk.

**Meshing happens per 16³ section.** Only faces touching something
see-through are emitted, each vertex gets three-sample ambient occlusion, and
sky light falls off with depth below the surface. Editing a block rebuilds
only the sections it can possibly affect.

**Lighting is two things.** Sky light is baked into the mesh, cheap and
static. Light *sources* are per-pixel point lights in the fragment shader —
the four nearest to the camera are uploaded each frame — which is why a
lantern lights a cave smoothly instead of in blocky steps.

**There are no image or audio files.** The texture atlas is drawn on a 2D
canvas at startup (about two milliseconds) and the sounds are filtered noise
bursts and short oscillator blips. Nothing to download, nothing to 404.

**Generation and meshing run on a time budget** — about 7 ms a frame — so the
world fills in while you walk instead of freezing on a hitch.

### Tuning it for a slow phone

The menu covers the two settings that matter: **render distance** (try 3–4)
and **resolution** (try 70%). Field of view and look sensitivity are there
too, and everything is remembered between sessions.

---

## Things it does not do

No mobs, no multiplayer, no redstone, no chests, no hunger. Water is static —
it fills oceans and lakes but does not flow into the hole you dug. There is
one save slot, held in the browser's storage, so clearing site data clears the
world. None of that is hard to add; it just is not here yet.
