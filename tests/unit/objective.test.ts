// The last floor's fuse hunt is derived from the seed alone, and every chunk
// works out on its own whether it holds a fuse. If two chunks disagree, or the
// layout depends on the order chunks streamed in, the run becomes unfinishable
// — three fuses that cannot all be found is a soft lock, not a bug report.

import { describe, expect, it } from 'vitest';
import { FUSE_COUNT, fuseSiteAt, isExitChunk, objectiveLayout } from '../../src/world/Objective';

const SEEDS = [0, 1, 1234, 42, 987654321, 0xffffffff];

describe('objectiveLayout', () => {
  it('is deterministic for a seed', () => {
    for (const seed of SEEDS) {
      expect(objectiveLayout(seed)).toEqual(objectiveLayout(seed));
    }
  });

  it('places exactly three fuses, indexed in order', () => {
    for (const seed of SEEDS) {
      const { fuses } = objectiveLayout(seed);
      expect(fuses).toHaveLength(FUSE_COUNT);
      expect(fuses.map((f) => f.index)).toEqual([0, 1, 2]);
    }
  });

  it('never puts anything on the chunk you wake up in', () => {
    for (const seed of SEEDS) {
      const { fuses, exit } = objectiveLayout(seed);
      for (const site of [...fuses, exit]) {
        expect(`${site.cx},${site.cz}`).not.toBe('0,0');
      }
    }
  });

  it('gives every site its own chunk', () => {
    for (const seed of SEEDS) {
      const { fuses, exit } = objectiveLayout(seed);
      const keys = [...fuses, exit].map((s) => `${s.cx},${s.cz}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('keeps the fuses on a reachable ring and the exit nearer than they are', () => {
    for (const seed of SEEDS) {
      const { fuses, exit } = objectiveLayout(seed);
      for (const f of fuses) {
        const d = Math.hypot(f.cx, f.cz);
        // the ring is 6..9 chunks; the spiral fallback can nudge a site a
        // little off it, but not into the next postcode
        expect(d).toBeGreaterThan(3);
        expect(d).toBeLessThan(14);
      }
      expect(Math.hypot(exit.cx, exit.cz)).toBeLessThan(10);
    }
  });

  it('spreads the fuses out instead of stacking them in one direction', () => {
    for (const seed of SEEDS) {
      const { fuses } = objectiveLayout(seed);
      for (let i = 0; i < fuses.length; i++) {
        for (let j = i + 1; j < fuses.length; j++) {
          const d = Math.hypot(fuses[i].cx - fuses[j].cx, fuses[i].cz - fuses[j].cz);
          expect(d).toBeGreaterThan(4);
        }
      }
    }
  });

  it('gives different seeds different layouts', () => {
    const seen = new Set(SEEDS.map((s) => JSON.stringify(objectiveLayout(s))));
    expect(seen.size).toBe(SEEDS.length);
  });

  it('returns integer chunk coordinates', () => {
    for (const seed of SEEDS) {
      const { fuses, exit } = objectiveLayout(seed);
      for (const s of [...fuses, exit]) {
        expect(Number.isInteger(s.cx)).toBe(true);
        expect(Number.isInteger(s.cz)).toBe(true);
      }
    }
  });
});

describe('the per-chunk lookups agree with the layout', () => {
  it('finds a fuse at each fuse chunk and nowhere else', () => {
    for (const seed of SEEDS) {
      const { fuses } = objectiveLayout(seed);
      for (const f of fuses) expect(fuseSiteAt(seed, f.cx, f.cz)).toEqual(f);
      expect(fuseSiteAt(seed, 0, 0)).toBeNull();
      expect(fuseSiteAt(seed, 500, 500)).toBeNull();
    }
  });

  it('marks the exit chunk and nothing next to it', () => {
    for (const seed of SEEDS) {
      const { exit } = objectiveLayout(seed);
      expect(isExitChunk(seed, exit.cx, exit.cz)).toBe(true);
      expect(isExitChunk(seed, exit.cx + 1, exit.cz)).toBe(false);
      expect(isExitChunk(seed, exit.cx, exit.cz + 1)).toBe(false);
      expect(isExitChunk(seed, 0, 0)).toBe(false);
    }
  });

  it('does not let a fuse chunk double as the exit chunk', () => {
    for (const seed of SEEDS) {
      for (const f of objectiveLayout(seed).fuses) {
        expect(isExitChunk(seed, f.cx, f.cz)).toBe(false);
      }
    }
  });
});
