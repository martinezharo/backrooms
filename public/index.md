# The Backrooms

The Backrooms is a free, open-source first-person survival-horror game that runs directly in a modern web browser. It requires no account, download, installation, or payment and contains no ads.

## Game experience

- Explore a procedurally generated, chunk-streamed world across six distinct levels: Level 0, Level 1, Level 37, Level 7, Level 2, and Level !.
- Manage health, thirst, oxygen, torch charge, carried water, weapons, ammunition, and inventory weight.
- Evade or fight stalking entities with different behaviors.
- Find routes between levels, collect fuses, activate the final portal, and escape.
- Resume an unfinished run from a browser-local checkpoint and keep local completion records.
- Replay a deterministic world by supplying a seed in the URL, for example `?seed=1234`.

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
