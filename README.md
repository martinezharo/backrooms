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
pnpm check        # TypeScript check — game, Worker and tests
pnpm test         # unit and Worker tests
pnpm test:e2e     # build, serve and drive the game in a headless browser
pnpm build        # TypeScript check plus static Vite build in dist/
pnpm preview      # build, then serve the Workers asset locally
pnpm deploy       # build and deploy with Wrangler
```

The development environment enables `VITE_HACKS=dev`, which exposes the
`window.__game` handle and shortcuts used by the headless checks. Production
builds omit those hacks.

## Tests

Two layers, and they answer different questions.

`pnpm test` runs [Vitest](https://vitest.dev) over the parts of the game that
can be reasoned about without a GPU: the seeded generators, the save file, the
records, the item catalog and the inventory grid, the survival stats, the level
table, combat, the fuse and descent layouts, the timecode, the control labels,
and the telemetry client. Worker handler tests run in Cloudflare's `workerd`
runtime. The suite also holds
[`index.html`](index.html) against every `getElementById` in the codebase, and
the Worker's accepted events against the ones the game can send — two contracts
nothing else in the build can see across.

`pnpm test:e2e` builds the game with the dev hacks on, serves `dist/client`
and drives the result through Puppeteer: it starts a run, walks, opens the bag,
visits all six floors and their ways down, saves and resumes a checkpoint,
escapes through the portal, and plays the whole thing again on a phone-sized
touchscreen. Each check prints a pass/fail line and sets an exit code.

```sh
pnpm test:e2e                      # everything, from a fresh build
pnpm test:e2e --only smoke,save    # just those
pnpm test:e2e --no-build           # reuse dist/ as it stands
```

Set `SHOT_DIR` to collect the screenshots somewhere other than `/tmp`. Against
a server you started yourself, each script also takes a URL:

```sh
pnpm dev --port 5199
node scripts/smoke.mjs 'http://localhost:5199/?seed=1234'
```

[`scripts/inspect.mjs`](scripts/inspect.mjs) is a probe rather than a gate: it
sits through the encounter director's 45-second grace period, so it is run by
hand after touching the spawner or the water.

[CI](.github/workflows/ci.yml) runs the type checks, the unit tests, a
production build and the headless checks on every push and pull request. The
repository's `pnpm build` path, which `pnpm deploy` also uses, rejects a client
bundle containing the `window.__game` handle or the floor-skipping shortcuts.

## Anonymous gameplay analytics

The game sends minimal anonymous telemetry about gameplay events, with no IP,
identifier, seed, or save data. Disable it with `?telemetry=off`
(`?telemetry=on` re-enables it); see [the detailed analytics notes](docs/analytics.md).

## Controls

| Input | Action |
|---|---|
| `WASD` + mouse | Move and look |
| Arrow keys | Turn and tilt, for touchpads and anyone without a mouse |
| `Shift` | Sprint |
| `Space` / `C` | Jump or swim up / crouch or swim down |
| `E` | Interact, pick up, or use the current objective |
| `LMB` / `RMB` | Attack / block, aim, or drink depending on the item |
| `Tab` / `I` | Inventory |
| `F` / `R` / `G` | Torch / receiver / drop |
| `Esc` | Pause and save a checkpoint |

Look speed lives on the pause screen and is remembered between runs. A touchpad
has far less travel than a mousepad, so it usually wants two or three times the
mouse default.
