# Recorded clips

Every clip here is **CC0 / public domain** — no attribution is legally required,
but the provenance is recorded so the sources stay traceable.

All were trimmed to a single event, mixed to mono, faded at the cuts, peak
normalized and re-encoded to 32 kHz / 64 kbps MP3 (MP3 because it is the one
format every browser decodes, iOS Safari included). They are deliberately dry:
distance, head-shadow, orbit and reverb are applied at runtime by
`playHaunt()` in `../AudioEngine.ts`.

## Hauntings

| clip | source | author | origin |
| --- | --- | --- | --- |
| `far_scream.mp3` | [Horror Scream1](https://opengameart.org/content/horror-scream1) | Michel Baradari (OpenGameArt) | `scream_horror1_0.mp3`, 0.85–3.60 s |
| `metal_fall.mp3` | [100 CC0 metal and wood SFX](https://opengameart.org/content/100-cc0-metal-and-wood-sfx) | rubberduck (OpenGameArt) | `metal_falling_01.ogg`, 0.05–1.75 s |
| `far_bang.mp3` | [100 CC0 metal and wood SFX](https://opengameart.org/content/100-cc0-metal-and-wood-sfx) | rubberduck (OpenGameArt) | `wood_slam_03.ogg`, full |
| `drag_scrape.mp3` | [Scrapes](https://opengameart.org/content/scrapes) | OpenGameArt | `scrape-3.ogg`, full |
| `ear_whisper.mp3` | ["I see you" Voice](https://opengameart.org/content/i-see-you-voice) | OpenGameArt | `i_see_you_voice_0.mp3`, 0.25–4.10 s |

## Footsteps and water (`steps/`)

Also CC0. These are not hand-edited: `scripts/footsteps.mjs` fetches the packs
below, cuts one event out of each take, levels the takes of a group against each
other and encodes them, so re-running it reproduces the files in this directory.

Steps are stored as left/right pairs — the split is arbitrary, and only there to
give each foot its own identity across the walk cycle. There are two dry
surfaces and no more: every floor that isn't Level 0's carpet shares one neutral
indoor step, because a floor-specific recording in a tunnel or a poolroom reads
as the wrong room rather than as detail.

Water is not a set of footsteps at all. `wade_loop.mp3` is a seamless loop of
water being moved around, which the engine rides on your speed and swells once
per stride; the impacts are only for arriving in it from a jump.

| clip | source | author | takes |
| --- | --- | --- | --- |
| `step_carpet_*` | [Footsteps Leather, Cloth, Armor](https://opengameart.org/content/footsteps-leather-cloth-armor) | haeldb (OpenGameArt) | `step_cloth1–4.ogg` |
| `step_hard_*` | same pack | haeldb (OpenGameArt) | `step_lth1, 2, 33, 4.ogg` |
| `water_impact_*` | [40 CC0 water / splash / slime SFX](https://opengameart.org/content/40-cc0-water-splash-slime-sfx) | rubberduck (OpenGameArt) | `splash_10, 14, 15.ogg` |
| `wade_loop` | same pack | rubberduck (OpenGameArt) | `loop_water_01.ogg`, tail crossfaded back over the head |
