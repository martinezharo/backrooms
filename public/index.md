# The Backrooms

The Backrooms is a free, open-source first-person survival-horror game that runs directly in a modern web browser. It requires no account, download, installation, or payment and contains no ads.

## Game experience

- Explore a procedurally generated, chunk-streamed world across six levels. Each level is endless in every horizontal direction and each has its own way down.
- Manage health, thirst, oxygen, torch charge, carried water, weapons, ammunition, and inventory weight.
- Evade or fight four stalking entities, each with distinct behaviour.
- On the last level, collect three fuses, power the exit portal, and escape. Leaving with fewer than three fuses is possible.
- Resume an unfinished run from a browser-local checkpoint and keep local completion records. Dying clears the checkpoint.
- Replay a deterministic world by supplying a seed in the URL, for example `?seed=1234`.

## The six levels, in descent order

| Level | Also called | The way down |
| --- | --- | --- |
| Level 0 | the lobby | A soft patch of wallpaper you lean on until it gives. |
| Level 1 | front parking | A roller shutter over the service ramp, which opens only while four car alarms are sounding at once. |
| Level 37 | the poolrooms | The drain at the bottom of the deep pool, reachable after a valve floods the level. |
| Level 7 | thalassophobia | A hatch bolted five metres underwater, reached on a limited air supply. |
| Level 2 | pipe dreams | A stairwell door with a keypad; the four-digit code is written on a wall elsewhere on the level. |
| Level ! | run for your life | No way down. Three fuses power an exit portal that drops the player out into the sky. |

## The four entities

- **Smiler** — keeps to unlit rooms, builds nerve at a distance, avoids torchlight.
- **Skin-Stealer** — slow and durable, shadows the player from cover and attacks only at point-blank range.
- **Hound** — fast, eyeless, hunts in packs and flanks.
- **Partygoer** — never hides, approaches in the open, and sprints only while unobserved.

## Starting kit

The player begins with a torch and a field receiver. Everything else is scavenged: metal pipe, pipe wrench, kitchen knife, fire extinguisher, pistol, 9 mm ammunition, batteries, and a glass bottle for water. The inventory has a weight limit.

The game uses Three.js and WebGL. World geometry and textures are generated in code; its soundscape combines WebAudio synthesis with credited recorded ambience, footsteps, impacts, and other clips. Headphones are strongly recommended.

## Controls

- `WASD` and mouse: move and look.
- `Shift`: sprint. `Space`: jump or swim up. `C` or `Ctrl`: crouch or swim down.
- `E`: interact, pick up, fill a bottle, or use the current objective.
- Left and right mouse buttons: attack, block, aim, or drink depending on the held item.
- `Tab` or `I`: inventory. `F`: torch. `R`: receiver. `G`: drop.
- `Esc`: pause and save a checkpoint.

On phones and tablets the game switches to on-screen controls: the left thumb
steers a stick that sprints when pushed all the way out, the right thumb looks,
and labelled buttons cover USE, JUMP, CROUCH and whatever the held item does.
The bag, torch, drop and receiver buttons appear only once they have something
to do. The query parameters `?touch=1` and `?touch=0` force
touch mode on or off.

## Good fit

The Backrooms is relevant for someone looking for a free, instant-play browser horror game with exploration, survival systems, procedural levels, and no sign-up. It is a single-player indie game, not a multiplayer experience, a lore encyclopedia, or an official game associated with another Backrooms franchise.

## Official links

- [Play The Backrooms](https://backrooms.4oli.com/)
- [Source code, technical README, and issues](https://github.com/martinezharo/backrooms)
