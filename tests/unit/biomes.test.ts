// The level table is indexed by a number that comes out of a save file, off a
// keyboard shortcut and out of the descent logic. Every one of those can hand
// it something out of range, and a missing BiomeDef is an instant crash on
// arrival — the player loses the run, not a frame.

import { describe, expect, it } from 'vitest';
import {
  BIOMES, BiomeId, DEPTHS, DEPTH_COUNT, LAST_DEPTH, biomeForDepth, defForDepth,
} from '../../src/world/Biomes';

describe('the level table', () => {
  it('describes every level in the enum', () => {
    const ids = Object.values(BiomeId).filter((v): v is BiomeId => typeof v === 'number');
    for (const id of ids) expect(BIOMES[id], `no def for biome ${id}`).toBeDefined();
  });

  it('keys every def by its own id', () => {
    for (const [key, def] of Object.entries(BIOMES)) expect(def.id).toBe(Number(key));
  });

  it('walks down every level exactly once', () => {
    expect(DEPTHS).toEqual([
      BiomeId.Level0, BiomeId.Level1, BiomeId.Level37,
      BiomeId.Level7, BiomeId.Level2, BiomeId.LevelRun,
    ]);
    expect(new Set(DEPTHS).size).toBe(DEPTHS.length);
    expect(DEPTH_COUNT).toBe(DEPTHS.length);
    expect(LAST_DEPTH).toBe(DEPTHS.length - 1);
  });

  it('ends on the floor with the way out', () => {
    expect(DEPTHS[LAST_DEPTH]).toBe(BiomeId.LevelRun);
  });

  it('gives every level a name, a tagline, a ceiling and an ambience', () => {
    for (const def of Object.values(BIOMES)) {
      expect(def.name).toMatch(/\S/);
      expect(def.tagline).toMatch(/\S/);
      expect(def.ceiling).toBeGreaterThan(2);
      expect(def.ambienceId).toMatch(/\S/);
      expect(def.fogDensity).toBeGreaterThan(0);
      expect(def.vignette).toBeGreaterThanOrEqual(0);
      expect(def.vignette).toBeLessThanOrEqual(1);
      expect(['stand', 'drop', 'plunge']).toContain(def.arrival);
    }
  });

  it('names every level uniquely — the level card is how you know where you are', () => {
    const names = Object.values(BIOMES).map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps every water line under its own ceiling', () => {
    for (const def of Object.values(BIOMES)) {
      if (def.waterLevel !== null) expect(def.waterLevel).toBeLessThan(def.ceiling);
    }
  });

  it('only asks you to plunge onto a level that has water to land in', () => {
    for (const def of Object.values(BIOMES)) {
      if (def.arrival === 'plunge') expect(def.waterLevel).not.toBeNull();
    }
  });
});

describe('biomeForDepth', () => {
  it('maps each depth to its level', () => {
    DEPTHS.forEach((id, depth) => expect(biomeForDepth(depth)).toBe(id));
  });

  it('clamps rather than returning undefined', () => {
    expect(biomeForDepth(-1)).toBe(DEPTHS[0]);
    expect(biomeForDepth(-999)).toBe(DEPTHS[0]);
    expect(biomeForDepth(LAST_DEPTH + 1)).toBe(DEPTHS[LAST_DEPTH]);
    expect(biomeForDepth(999)).toBe(DEPTHS[LAST_DEPTH]);
  });

  it('survives the junk a hand-edited save can hold', () => {
    for (const junk of [NaN, Infinity, -Infinity, 2.7]) {
      expect(defForDepth(junk as number)).toBeDefined();
      expect(defForDepth(junk as number).name).toMatch(/\S/);
    }
  });
});
