# THE BACKROOMS

> you noclipped out of reality

**▶ Play now: [backrooms.4oli.com](https://backrooms.4oli.com)** — free, no
download, no sign-up.

First-person survival horror set in the Backrooms, running **entirely in the
browser** — mouse and keyboard on a desktop, thumbstick and buttons on a phone.
Three.js / WebGL, TypeScript, Vite.

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

## The descent

The Backrooms are a building, and you are on the top floor of it. **Six levels,
stacked**, and the only direction that means anything is down. Each floor is one
biome from wall to wall, endless horizontally, and each one charges a different
price for the stairs — none of them is the same puzzle twice.

| # | Level | The floor | What it wants |
|---|---|---|---|
| 1 | **LEVEL 0** | endless yellow rooms, wet carpet, buzzing fluorescents | somewhere the wallpaper has gone **soft**. Find it, lean on it, noclip through |
| 2 | **LEVEL 1** | the parking under a supermarket that was never built | make **four car alarms** scream at the same time. They only scream for 42 seconds, and every one of them is an invitation |
| 3 | **LEVEL 37** | tiled pool halls, sunken basins, bounced light | open the **main valve**. The whole level starts filling. Get to the deep end before you have to swim there |
| 4 | **LEVEL 7** | black water, wall to wall, five metres deep | a **hatch** on the bottom with a seized wheel. Twelve seconds of cranking; you have twenty-two of air |
| 5 | **LEVEL 2** | concrete maintenance tunnels, pipes, drips | a stairwell door with a **keypad**. Four digits, and the only copy is sprayed on a wall somewhere else down here |
| 6 | **LEVEL !** | the lobby, remembered wrong | the way out, and it is not down |

The **field receiver** in your starting kit points at whatever this floor needs
next — the unlock first, then the way down — and ticks faster the closer you
get. A bearing, not a map.

Every floor takes your bag and your health with you and leaves everything else
behind: the level you just left is gone, and so is anything you put down in it.

### The bottom

**Level !** is the lobby built by something that only ever saw the lobby from a
distance — the same wallpaper drained of its warmth, the ceiling too tall, the
floor never quite level, graffiti on nearly every wall, and pieces of every
floor you came through lying around in it. A car on the ceiling. A pipe run
through a bedroom wall. Standing water in the carpet.

It is the only floor with a way *out* instead of a way down. Three **fuses**
sit on plinths in cleared rooms; somewhere else there's the **exit portal**, a
hole punched through a wall or the floor (50/50), looking straight down onto
the real world. Down here and down out there were never the same direction.
Dormant until you feed it fuses — press `R` to swing the receiver onto it.

- **3 fuses** — the door holds. Full escape.
- **1 or 2** — it opens anyway, badly. You can leave early if your nerve goes.

Step through and you fall: cloud deck, then open air, then a landscape of
fields, roads and a town coming up at you far too fast. Every fuse you pull
also raises the **pressure** — more entities, spawning sooner. So does every
car alarm, and so does getting the keypad wrong.

Records (escapes, descents, best time, deepest floor) persist in `localStorage`.

## Breath

Your head going under starts a clock. **Oxygen** drains in about twenty-two
seconds, comes back in five at the surface, and once it's empty it takes health
instead. The bar only appears when it is not full — on four of the six floors it
never moves. On Level 7 it is the entire game, and on Level 37 it becomes the
game the moment you turn that valve.

## Putting it down

A run autosaves every 20 seconds, on pause and when the tab goes away, so the
landing page can offer **CONTINUE** instead of DESCEND. The pause menu says so
out loud and has a **SAVE & QUIT** that drops you back on the landing page with
the run waiting — closing the tab does the same thing, quietly. The maze itself is never
written down — it regenerates from the seed — so a checkpoint is under a
kilobyte of `localStorage`: where you stood, what's in the bag and what you did
to the floor (fuses pulled, items dropped, machines drained, the door fed,
monsters hugged). Hostile entities aren't saved; the level sends more.

A checkpoint also remembers **which floor you were on** and how far through its
toll you had got — the water already risen, the wheel already cranked, the code
already read — so CONTINUE puts you back on Level 37 with the level still
filling, not back in the lobby.

The checkpoint is for putting the game down, not for undoing it: dying or
stepping through the portal wipes it, and starting a fresh descent rolls a new
seed. A `?seed=` in the URL always wins over the saved one.

## The world

Infinite, chunk-streamed, deterministic from the seed — but only sideways. A
floor is one biome from end to end, so walking never changes the level; the
only thing that does is paying what the floor asks. Descending tears the whole
world down and rebuilds it one level lower from the same seed.

The cars are boxes and cylinders like everything else here. A downloaded
hatchback with real topology would be the only object in the game with any,
which reads worse than a shape that agrees with its surroundings — so they are
modelled in code, one silhouette in nine paints, which is what a car park
actually looks like.

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
- Drink by **crouching at wall taps** (the dry floors) or by **submerging** in
  water (much faster — and on Level 7 you are always submerged, which is the
  one mercy that floor gives you).
- **Glass bottles double as canteens.** Some are found full, some empty. Hold a
  bottle and press `E` at a tap or standing in water to fill it, then hold RMB
  anywhere to drink it back. It still throws just as well when empty.
- Health regenerates slowly while you stay hydrated (> 60%).

## Items & combat

You start every run already holding the **torch** (lit, `F` toggles it) and the
**field receiver** — neither spawns in the world. Everything else is scavenged
from the floor and from tables (glowing ring): pipe wrench, metal pipe, kitchen
knife, glass bottle (throwable canteen), fire extinguisher (stun cloud), pistol
(if you find ammo). Each has damage, speed, durability and weight.

The torch burns through its charge in about five minutes. **Batteries** are
never carried: walk over one and `E` pours it straight into the torch (+55%),
and a full torch leaves it on the floor for later. **Almond water machines** on the
dry floors refill your thirst instantly, three servings each; a machine you
drained is gone the moment you descend past it. Grid inventory
(Tarkov-style), 10 weight units max, one item in hand.

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
| E | Pick up / interact / fill the held bottle at water |
| E (held) | Push the soft wall, turn the valve, crank the hatch wheel |
| LMB | Attack (fists if unarmed) |
| RMB | Block (melee) / aim (pistol) / drink from the held bottle |
| 1–9 / 0 | Quick-equip hotbar item (same key again puts it away) |
| Mouse wheel | Cycle items → empty hands |
| G | Drop held item |
| TAB / I | Inventory |
| F | Torch on/off (recharge it by grabbing batteries) |
| R | On Level !: point the receiver at the fuses / at the exit |
| Esc | Pause |

### On a phone or tablet

Touch devices get on-screen controls automatically: a thumbstick that appears
wherever your left thumb lands (**push it to the rim to sprint**), a look pad
under your right thumb, and buttons for everything else — HIT, BLOCK, USE,
JUMP, plus latching RUN and CROUCH. The top row holds BAG, TORCH, RCVR, DROP,
a hug button and pause. Tap a hotbar slot to put that item in your hand; the
bag itself is tap-to-equip and DROP throws down what you're holding. Starting a
run asks for full screen and landscape, and the HUD reflows around your thumbs.

Force the controls on or off with `?touch=1` / `?touch=0` — handy for trying
the layout on a desktop.

## Project structure

```
src/
├── core/        Game orchestrator, input, constants, seeded RNG
├── world/       Chunk streaming, procedural layout, levels, the descent, geometry
├── player/      First-person controller, combat, survival stats
├── enemies/     Stalker AI base, the four entities, spawn director, anatomy helpers
├── audio/       WebAudio synthesis: SFX, ambiences, cues, procedural score
├── rendering/   Lighting (threat-aware torch), water shader, post FX, textures
├── items/       Item defs, grid inventory, world pickups, item meshes
└── ui/          HUD + hotbar, inventory UI, menus, touch controls, SVG icons
```

## Dev hacks

`pnpm dev` loads `.env.development`, which sets `VITE_HACKS=dev` and turns on a
few shortcuts that exist only for building the game:

| Key | |
|---|---|
| `PageDown` / `PageUp` | one floor down / up, skipping that floor's way down |
| `\` | jump to this floor's way down |
| `Shift` + `\` | jump to whatever unlocks it (valve, code on a wall) |

It also puts the `window.__game` handle the headless scripts drive on the page.

None of this reaches players: `VITE_HACKS` is inlined at build time, so in a
production build (`pnpm build`, `pnpm deploy`) the flag is `false`, the handle
is never attached and the key checks are dropped from the bundle. To get a
production-shaped build that keeps them, run `VITE_HACKS=dev pnpm build`.

## Dev scripts

Headless verification (needs Puppeteer with a working Chrome; serve the game
on port 5199 first, e.g. `pnpm dev --port 5199`):

```sh
node scripts/smoke.mjs    # boots the game, walks, opens UI, reports errors
node scripts/mobile.mjs   # phone viewport: drives the stick, look pad, buttons
node scripts/tour.mjs     # screenshots every floor and every way down to /tmp
node scripts/inspect.mjs  # probes world internals (taps, lights, water, enemies)
node scripts/escape.mjs   # runs a whole extraction: portal, fuses, the fall
node scripts/save.mjs     # checkpoint round trip: quit, CONTINUE, compare state
```

`scripts/escape.mjs` takes an optional seed and shoots the portal (dormant and
open) plus five moments of the fall — the fastest way to check the sequence
after touching `rendering/Escape.ts` or `rendering/AerialView.ts`.

---

⚠ **Headphones strongly recommended.** The whispers are positional for a reason.
