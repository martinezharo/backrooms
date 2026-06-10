# THE BACKROOMS

> you noclipped out of reality

**▶ Play now: [backrooms.4oli.com](https://backrooms.4oli.com)** — free, no
download, no sign-up.

First-person survival horror set in the Backrooms, running **entirely in the
browser**. Three.js / WebGL, TypeScript, Vite.

**Every asset is procedural.** Textures are painted on canvases at runtime,
monsters are built from organic lathe geometry with generated skin textures,
icons are inline SVG, and all audio (ambience, music, whispers, stingers, SFX)
is synthesized live with WebAudio. The production build ships zero media files.

## Play

The game lives at **[backrooms.4oli.com](https://backrooms.4oli.com)** — open
it in any modern browser and press DESCEND.

To run it locally instead:

```sh
pnpm install
pnpm dev          # then open http://localhost:5173
```

`pnpm build` type-checks and produces a static build in `dist/` you can host
anywhere (it's just static files). `pnpm check` runs the type-check alone.

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

## They are here

Entities don't rush you — they **hunt** you. Each one notices you silently,
shadows you from cover behind your back, freezes and stares when you catch it
in the open, slips behind corners if you watch too long, and builds up the
nerve to strike — preferably the moment you look away, preferably in the dark.

- **Smilers** — a smear of darkness wearing a face. The grin widens when you
  look at it. Fast in the dark, repelled by light — and it only ever attacks
  from darkness.
- **Skin-Stealers** — emaciated things wearing someone. The most patient:
  they wait around corners and strike point-blank. The jaw hangs open wider
  the closer they are to committing.
- **Hounds** — eyeless quadrupeds with skin stretched over the wrong skeleton.
  Hunt in packs; when one commits, the pack comes.
- **Partygoers** — wrong birthday clowns. They don't hide. They just keep
  ambling closer... then they sprint. =)

The sound design is the warning system: by default you hear only the room
tone. A faint directional whisper means something is stalking you. A stinger
means it has committed. Your **torch dims and flickers** as anything gets
closer — at touch range you're in the dark. Heartbeat and music tension track
the danger.

## Survival

- **Thirst** drains constantly — and **fast while sprinting**. At zero you
  can't run anymore, and your health starts draining at an accelerating rate.
- Drink by **crouching at wall taps** (Levels 0/2) or by **submerging** in
  pool water (much faster).
- Health regenerates slowly while you stay hydrated (> 60%).

## Items & combat

Weapons spawn on the floor and on tables (glowing ring): pipe wrench, metal
pipe, kitchen knife, glass bottle (throwable), fire extinguisher (stun cloud),
pistol (if you find ammo), torch. Each has damage, speed, durability and
weight. Grid inventory (Tarkov-style), 10 weight units max, one item in hand.

A **hotbar** keeps everything reachable without opening the bag: number keys
equip directly, the mouse wheel cycles items, G drops what you're holding.
Inside the bag: click to equip, hover to inspect a rotating 3D model, drag an
item out of the panel to drop it.

## Controls

| Key | Action |
|---|---|
| WASD / Mouse | Move / look |
| Shift | Sprint (drains thirst fast — impossible at 0 thirst) |
| Space | Jump · swim up (swim against a pool edge to climb out) |
| C / Ctrl | Crouch · drink at taps · swim down |
| E | Pick up / interact |
| LMB | Attack (fists if unarmed) |
| RMB | Block (melee) / aim (pistol) |
| 1–9 / 0 | Quick-equip hotbar item (same key again puts it away) |
| Mouse wheel | Cycle items → empty hands |
| G | Drop held item |
| TAB / I | Inventory |
| F | Torch |
| Esc | Pause |

## Project structure

```
src/
├── core/        Game orchestrator, input, constants, seeded RNG
├── world/       Chunk streaming, procedural layout, biomes, geometry
├── player/      First-person controller, combat, survival stats
├── enemies/     Stalker AI base, the four entities, spawn director, anatomy helpers
├── audio/       WebAudio synthesis: SFX, ambiences, cues, procedural score
├── rendering/   Lighting (threat-aware torch), water shader, post FX, textures
├── items/       Item defs, grid inventory, world pickups, item meshes
└── ui/          HUD + hotbar, inventory UI, menus, SVG icons
```

## Dev scripts

Headless verification (needs Puppeteer with a working Chrome; serve the game
on port 5199 first, e.g. `pnpm dev --port 5199`):

```sh
node scripts/smoke.mjs    # boots the game, walks, opens UI, reports errors
node scripts/tour.mjs     # screenshots all four levels to /tmp
node scripts/inspect.mjs  # probes world internals (taps, lights, water, enemies)
```

---

⚠ **Headphones strongly recommended.** The whispers are positional for a reason.
