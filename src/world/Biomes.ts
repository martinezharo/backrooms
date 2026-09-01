// The levels of the Backrooms, stacked.
//
// The world used to be a patchwork you wandered between: noise decided which
// biome a chunk belonged to and you crossed borders by walking. It isn't any
// more. A level is one floor of the building, uniform from end to end and
// endless in every horizontal direction — the only direction that means
// anything is down, and every floor has its own price for letting you use it.

import { BiomeId, DEPTHS, LAST_DEPTH } from '../../shared/floors';

export { BiomeId, DEPTHS, DEPTH_COUNT, LAST_DEPTH } from '../../shared/floors';

/** How you land on a floor when you drop onto it from the one above. */
export type Arrival =
  | 'stand'    // you walked in on your own feet
  | 'drop'     // you came through the ceiling and there is floor below
  | 'plunge';  // you came through the ceiling and there is water below

export interface BiomeDef {
  id: BiomeId;
  name: string;
  /** the line under the name on the level card */
  tagline: string;
  ceiling: number;
  fogColor: number;
  fogDensity: number;
  ambientColor: number;
  ambientIntensity: number;
  lightColor: number;
  lightIntensity: number;
  /** post-process vignette strength; low keeps the frame flat and evenly lit */
  vignette: number;
  /** colour the frame is multiplied by while the camera is submerged */
  underwaterTint: number;
  /** water surface height, or null when the level is dry */
  waterLevel: number | null;
  ambienceId: 'hum' | 'garage' | 'tunnel' | 'pool' | 'deep' | 'wrong';
  arrival: Arrival;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  [BiomeId.Level0]: {
    id: BiomeId.Level0,
    name: 'LEVEL 0',
    tagline: 'the lobby',
    ceiling: 3.1,
    // Liminal haze: distance dissolves into pale yellow light, never darkness.
    fogColor: 0x7c7145,
    fogDensity: 0.022,
    ambientColor: 0x9c9163,
    ambientIntensity: 0.82,
    lightColor: 0xfff2c8,
    lightIntensity: 7.5,
    vignette: 0.18,
    underwaterTint: 0x74d9bf,
    waterLevel: null,
    ambienceId: 'hum',
    arrival: 'stand',
  },
  [BiomeId.Level1]: {
    id: BiomeId.Level1,
    name: 'LEVEL 1',
    tagline: 'front parking, level −1',
    // Low enough that the ceiling ducts are always in the top of the frame.
    ceiling: 2.9,
    // Sodium light going grey-green in the haze — the colour of a car park at
    // four in the morning, which is a colour, not an absence of one.
    fogColor: 0x3c4038,
    fogDensity: 0.036,
    ambientColor: 0x6b7168,
    ambientIntensity: 0.55,
    lightColor: 0xf2ead0,
    lightIntensity: 11,
    vignette: 0.34,
    underwaterTint: 0x74d9bf,
    waterLevel: null,
    ambienceId: 'garage',
    arrival: 'drop',
  },
  [BiomeId.Level37]: {
    id: BiomeId.Level37,
    name: 'LEVEL 37',
    tagline: 'the poolrooms',
    ceiling: 4.6,
    // The poolrooms are bright, humid and clean — the dread is that they are
    // endless, not that they are dark. Everything reads as bounced light.
    fogColor: 0x8ea8a5,
    fogDensity: 0.042,
    ambientColor: 0xb3cac6,
    ambientIntensity: 0.85,
    lightColor: 0xdffbff,
    lightIntensity: 8.5,
    vignette: 0.3,
    underwaterTint: 0x8ef0ea,
    // Sits below the walkable floor, so it only shows in the sunken basins —
    // until the main valve goes and the whole level starts filling up.
    waterLevel: -0.35,
    ambienceId: 'pool',
    arrival: 'stand',
  },
  [BiomeId.Level7]: {
    id: BiomeId.Level7,
    name: 'LEVEL 7',
    tagline: 'thalassophobia',
    // Deep enough that the bottom is a dive, not a paddle, with enough air
    // over the water that arriving through the ceiling is a fall.
    ceiling: 9,
    fogColor: 0x020608,
    fogDensity: 0.1,
    ambientColor: 0x1c2c38,
    ambientIntensity: 0.32,
    lightColor: 0x96b8d0,
    lightIntensity: 8,
    vignette: 0.68,
    underwaterTint: 0x2f6b62,
    waterLevel: 6.6,
    ambienceId: 'deep',
    arrival: 'plunge',
  },
  [BiomeId.Level2]: {
    id: BiomeId.Level2,
    name: 'LEVEL 2',
    tagline: 'pipe dreams',
    ceiling: 2.45,
    // Not a void: the haze holds the sodium light so the tunnel fades out
    // ahead of you instead of ending in black.
    fogColor: 0x271d12,
    fogDensity: 0.05,
    ambientColor: 0x685740,
    ambientIntensity: 0.8,
    lightColor: 0xffb066,
    lightIntensity: 13,
    vignette: 0.42,
    underwaterTint: 0x74d9bf,
    // Dry. Whatever came down the hatch with you drained away long before you
    // got here — the tunnels are dust and cable, not a paddling pool.
    waterLevel: null,
    ambienceId: 'tunnel',
    arrival: 'drop',
  },
  [BiomeId.LevelRun]: {
    id: BiomeId.LevelRun,
    name: 'LEVEL !',
    tagline: 'run for your life',
    // The lobby's proportions, remembered wrong — a little too tall.
    ceiling: 3.45,
    // The same yellow, drained of everything that made it warm.
    fogColor: 0x271f10,
    fogDensity: 0.055,
    ambientColor: 0x4a4128,
    ambientIntensity: 0.38,
    lightColor: 0xffd58a,
    lightIntensity: 9,
    vignette: 0.62,
    underwaterTint: 0x74d9bf,
    waterLevel: 0.06,
    ambienceId: 'wrong',
    arrival: 'stand',
  },
};

/**
 * A depth index arrives from a save file and from the records blob, both of
 * which are player-writable JSON. A fractional or non-finite one used to index
 * straight off the end of DEPTHS and hand back `undefined`, which took the
 * landing page down with it before the game had even started.
 */
export function biomeForDepth(depth: number): BiomeId {
  const i = Math.round(Number(depth));
  if (!Number.isFinite(i)) return DEPTHS[0];
  return DEPTHS[Math.max(0, Math.min(LAST_DEPTH, i))];
}

export function defForDepth(depth: number): BiomeDef {
  return BIOMES[biomeForDepth(depth)];
}
