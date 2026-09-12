# Arcade

Two small games for phone browsers, written from scratch with no engine, no
framework and no dependencies. Open the folder's `index.html` and pick one.

| | |
|---|---|
| **[Cubeland](cubeland/)** | A block-building sandbox. Mine, build and wander an endless procedurally generated world with caves, oceans, biomes and a day/night cycle. WebGL. |
| **[Swarm](swarm/)** | A one-thumb survival arena. You move; your weapons fire themselves. Survive the horde and choose an upgrade every level. Canvas 2D. |

Each game has its own README-worth of detail in its folder — see
[cubeland/README.md](cubeland/README.md).

## Running it

No build step. Serve the folder over HTTP (ES modules will not load from
`file://`):

```bash
npm start          # or: python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Putting it online

Push to GitHub and turn on Pages, or drop the folder into Netlify or Vercel.
There is no backend. Each game is also a PWA: open it on a phone and use
**Add to Home Screen** to play it fullscreen and offline.

## Layout

```
index.html      The launcher you are looking at
cubeland/       Voxel sandbox - WebGL renderer, chunked world generation
swarm/          Survival arena - Canvas 2D, procedural audio
```
