# THE BACKROOMS

First-person survival horror set in the Backrooms, running entirely in the
browser. Three.js / WebGL, TypeScript, Vite. **Every asset is procedural** —
textures are painted on canvases at runtime, monsters and weapons are built
from primitives, and all audio (ambience, music, monster voices, SFX) is
synthesized with WebAudio. No files are downloaded.

## Run

```sh
pnpm install
pnpm dev          # then open http://localhost:5173
```

`pnpm build` type-checks and produces a static build in `dist/`.

The world seed is in the URL (`?seed=1234`) — share it to share your maze.

## The world

Infinite, chunk-streamed, deterministic from the seed. Four levels blend into
each other through doorways, each with its own lighting, fog, soundscape and
architecture:

| Level | Theme |
|---|---|
| **Level 0** | Endless yellow rooms, wet carpet, buzzing fluorescents |
| **Level 2** | Concrete maintenance tunnels, pipes, darkness, drips |
| **Level 37** | Tiled pool halls with murky sunken basins — swim to drink fast |
| **Level 7** | Flooded black rooms, only the ceiling above the water line |

## Survival

- **Thirst** drains constantly (faster when sprinting). At zero, your health
  follows — at an accelerating rate.
- Drink by **crouching at wall taps** (Levels 0/2) or by **submerging** in
  pool water (much faster).
- Health regenerates slowly while you stay hydrated (> 60%).

## They are here

- **Smilers** — only their eyes and grin are visible. Fast in the dark; your
  torch is the only thing they respect.
- **Skin-Stealers** — slow, hard to kill, and they sound almost human.
- **Hounds** — fast quadrupeds, hunt in packs.
- **Partygoers** — yellow, smiling, erratic. They stop... then they sprint. =)

Music tension and your heartbeat rise as they close in.

## Items & combat

Weapons spawn on the floor and on tables (glowing ring): pipe wrench, metal
pipe, kitchen knife, glass bottle (throwable), fire extinguisher (stun cloud),
pistol (if you find ammo), torch. Each has damage, speed, durability, and
weight. Grid inventory (Tarkov-style), 10 weight units max, one weapon in
hand; right-click an item to inspect it as a rotating 3D model.

## Controls

| Key | Action |
|---|---|
| WASD / Mouse | Move / look |
| Shift | Sprint (thirstier) |
| Space | Jump · swim up · climb out of water |
| C / Ctrl | Crouch · drink at taps · swim down |
| E | Pick up / interact |
| LMB | Attack (fists if unarmed) |
| RMB | Block (melee) / aim (pistol) |
| TAB / I | Inventory |
| G | Drop equipped item |
| F | Torch |
| M | Minimap |
| Esc | Pause |

## Dev scripts

Headless verification (needs `puppeteer`, dev-only):

```sh
node scripts/smoke.mjs    # boots the game, walks, opens UI, reports errors
node scripts/tour.mjs     # screenshots all four levels to /tmp
node scripts/inspect.mjs  # probes world internals (taps, lights, water, enemies)
```
