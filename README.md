# THE BACKROOMS

> you noclipped out of reality

**Play now: [backrooms.4oli.com](https://backrooms.4oli.com)** — a first-person
survival-horror game that runs in the browser with no account or download.

## What is here

The game is a client-side Three.js/WebGL application written in TypeScript. A
seeded, chunk-streamed world provides six levels — `LEVEL 0`, `LEVEL 1`,
`LEVEL 37`, `LEVEL 7`, `LEVEL 2`, and `LEVEL !` — each with its own way down.
The final level replaces the descent with an escape portal and fuse objective.

The systems that define a run are:

- thirst, oxygen, health, torch charge, water, scavenged items, inventory, and
  melee/ranged combat;
- stalking entities with distinct behaviours;
- deterministic generation from `?seed=...`, with checkpoints and records in
  `localStorage`;
- desktop mouse/keyboard controls, and an on-screen rig for touch devices that
  labels every button with what it does to the thing in your hand and hides the
  ones you have nothing to use. Use `?touch=1` or `?touch=0` to force touch mode
  on or off.

The four screens you are not playing on — the landing page, the pause, the
death and the escape — are one design in [`src/menus.css`](src/menus.css), and
it is a place rather than a menu. The landing is a room drawn in elevation:
damp mono-yellow wall under a fluorescent tube, skirting, carpet, and two
doors standing on it that are the only buttons on the page. Everything a
reader or a crawler needs is on the paperwork taped to the wall further down,
past the light. The pause holds the frame the game stopped on instead of
covering it, death puts the tube out, and the escape screen throws the whole
palette away for daylight — the one screen in the game that is not yellow. A
grain-and-scanline layer with a running timecode sits over all four, so they
read as footage of the same descent.

World geometry and textures are generated in code. Audio combines WebAudio
synthesis with recorded ambience, footsteps, impacts, and other clips; see the
[audio credits](src/audio/clips/CREDITS.md). The interface uses one self-hosted
web font; see the [font credits](public/fonts/CREDITS.md).

## Development

```sh
pnpm install
pnpm dev          # Vite development server at http://localhost:5173
pnpm check        # TypeScript check
pnpm build        # TypeScript check plus static Vite build in dist/
pnpm preview      # build, then serve the Workers asset locally
pnpm deploy       # build and deploy with Wrangler
```

The development environment enables `VITE_HACKS=dev`, which exposes the
`window.__game` handle and shortcuts used by the headless checks. Production
builds omit those hacks.

## Browser checks

The Puppeteer scripts expect a running game, a Puppeteer-compatible Chrome, and
normally use port `5199`:

```sh
pnpm dev --port 5199
node scripts/smoke.mjs 'http://localhost:5199/?seed=1234'
node scripts/mobile.mjs 'http://localhost:5199/?seed=1234&touch=1'
node scripts/save.mjs 'http://localhost:5199/?seed=1234'
```

Other focused probes and tours are in [`scripts/`](scripts/).

## Anonymous gameplay analytics

The Worker counts probable engaged sessions (real start, 45 visible seconds,
and 5 m of movement) and records the event and Cloudflare country, without IPs
or identifiers. Use `?telemetry=off` to exclude your browser; `?telemetry=on`
re-enables it.

## Controls

| Input | Action |
|---|---|
| `WASD` + mouse | Move and look |
| `Shift` | Sprint |
| `Space` / `C` | Jump or swim up / crouch or swim down |
| `E` | Interact, pick up, or use the current objective |
| `LMB` / `RMB` | Attack / block, aim, or drink depending on the item |
| `Tab` / `I` | Inventory |
| `F` / `R` / `G` | Torch / receiver / drop |
| `Esc` | Pause and save a checkpoint |
