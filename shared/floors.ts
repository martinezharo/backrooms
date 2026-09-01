/** Stable identifiers and descent order shared by the game and its Worker. */
export enum BiomeId {
  Level0 = 0,    // classic yellow rooms — the lobby
  Level1 = 1,    // the parking under the supermarket that was never built
  Level37 = 2,   // the poolrooms
  Level7 = 3,    // thalassophobia, the flood
  Level2 = 4,    // maintenance tunnels
  LevelRun = 5,  // the lobby again, and wrong
}

/** The descent, in order. A telemetry depth is an index into this tuple. */
export const DEPTHS = [
  BiomeId.Level0,
  BiomeId.Level1,
  BiomeId.Level37,
  BiomeId.Level7,
  BiomeId.Level2,
  BiomeId.LevelRun,
] as const;

export const DEPTH_COUNT = DEPTHS.length;
/** The deepest valid index shared by saves, gameplay and telemetry. */
export const LAST_DEPTH = DEPTH_COUNT - 1;
