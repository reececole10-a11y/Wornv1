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

There is no build step and no backend, so any static host works. The whole
site is relative-path only: it runs correctly from a domain root *or* from a
subfolder.

### GitHub Pages (free, nothing to install)

1. On GitHub, open this repository and go to **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**.
3. Pick the branch that has this code and the folder **/ (root)**, then
   **Save**.
4. Wait a minute and open the URL it prints — for this repository that is
   `https://<your-username>.github.io/Wornv1/`.

Every push to that branch republishes the site.

**One thing to check first:** Pages publishes *everything* in the repository,
so any unrelated file sitting in the root (an old archive, notes, a backup)
becomes publicly downloadable. Delete anything you would not want strangers
fetching, or move the games into their own repository.

### Netlify or Vercel

Sign in with GitHub, pick the repository, and deploy. Leave the build command
empty and set the publish directory to the repository root. Netlify also
accepts the folder dragged straight onto its Sites page.

### Your own web host

Upload the whole folder over FTP/SFTP into any directory that is served over
**HTTPS** — the games are plain files. HTTPS matters: without it the service
worker will not register, so offline play and home-screen installs stop
working (the games themselves still run).

### Embedding it in a page you already have

Copy the `cubeland/` and `swarm/` folders onto your site and link to them, or
drop one into an existing page with an iframe:

```html
<iframe src="/swarm/" style="width:100%;aspect-ratio:9/16;border:0"
        allow="fullscreen; autoplay" title="Swarm"></iframe>
```

Give it a real height — these are fullscreen games, and an iframe with no
height collapses to nothing.

### On a phone

Open the live URL, then **Share → Add to Home Screen** (iOS) or
**Install app** (Chrome on Android). Each game installs separately, launches
fullscreen, and keeps working with no signal.

## Layout

```
index.html      The launcher you are looking at
cubeland/       Voxel sandbox - WebGL renderer, chunked world generation
swarm/          Survival arena - Canvas 2D, procedural audio
```
