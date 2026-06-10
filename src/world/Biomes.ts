// Biome (Backrooms "level") definitions and the world biome field.

import { fbm2 } from '../core/rng';
import { CHUNK } from '../core/constants';

export enum BiomeId {
  Level0 = 0,   // classic yellow rooms
  Level2 = 1,   // maintenance tunnels
  Level37 = 2,  // the swimming pool
  Level7 = 3,   // thalassophobia (flooded)
}

export interface BiomeDef {
  id: BiomeId;
  name: string;
  ceiling: number;
  fogColor: number;
  fogDensity: number;
  ambientColor: number;
  ambientIntensity: number;
  lightColor: number;
  lightIntensity: number;
  /** water surface height, or null when the biome is dry */
  waterLevel: number | null;
  ambienceId: 'hum' | 'tunnel' | 'pool' | 'deep';
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  [BiomeId.Level0]: {
    id: BiomeId.Level0,
    name: 'LEVEL 0',
    ceiling: 3.0,
    fogColor: 0x2c2715,
    fogDensity: 0.05,
    ambientColor: 0x6b6244,
    ambientIntensity: 0.55,
    lightColor: 0xfff0bb,
    lightIntensity: 26,
    waterLevel: null,
    ambienceId: 'hum',
  },
  [BiomeId.Level2]: {
    id: BiomeId.Level2,
    name: 'LEVEL 2',
    ceiling: 2.6,
    fogColor: 0x0d0b08,
    fogDensity: 0.085,
    ambientColor: 0x3a3228,
    ambientIntensity: 0.35,
    lightColor: 0xffc890,
    lightIntensity: 18,
    waterLevel: null,
    ambienceId: 'tunnel',
  },
  [BiomeId.Level37]: {
    id: BiomeId.Level37,
    name: 'LEVEL 37',
    ceiling: 4.6,
    fogColor: 0x122421,
    fogDensity: 0.045,
    ambientColor: 0x4d6b62,
    ambientIntensity: 0.5,
    lightColor: 0xc8f0e0,
    lightIntensity: 24,
    waterLevel: -0.35,
    ambienceId: 'pool',
  },
  [BiomeId.Level7]: {
    id: BiomeId.Level7,
    name: 'LEVEL 7',
    ceiling: 2.7,
    fogColor: 0x020608,
    fogDensity: 0.13,
    ambientColor: 0x1c2c38,
    ambientIntensity: 0.3,
    lightColor: 0x96b8d0,
    lightIntensity: 10,
    waterLevel: 1.75,
    ambienceId: 'deep',
  },
};

/**
 * Biome for a chunk, sampled from a low-frequency warped noise field at the
 * chunk center so biomes form multi-chunk regions with organic borders.
 */
export function biomeForChunk(seed: number, cx: number, cz: number): BiomeId {
  // World coords in "biome units" — one unit ≈ 5 chunks.
  const scale = 1 / (CHUNK * 4.5);
  const x = (cx + 0.5) * CHUNK * scale;
  const z = (cz + 0.5) * CHUNK * scale;
  // Domain warp for irregular region borders.
  const wx = x + (fbm2(seed + 71, x * 2.3, z * 2.3, 2) - 0.5) * 0.9;
  const wz = z + (fbm2(seed + 137, x * 2.3, z * 2.3, 2) - 0.5) * 0.9;
  const n = fbm2(seed + 11, wx, wz, 3);

  // Spawn area is always Level 0.
  if (Math.abs(cx) <= 1 && Math.abs(cz) <= 1) return BiomeId.Level0;

  if (n < 0.42) return BiomeId.Level0;       // most common
  if (n < 0.58) return BiomeId.Level2;
  if (n < 0.71) return BiomeId.Level37;
  if (n < 0.78) return BiomeId.Level7;
  return BiomeId.Level0;
}
