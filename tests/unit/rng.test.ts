// The seed is the whole contract of this game: `?seed=1234` has to build the
// same maze on every machine, on every build, forever. Anything that changes a
// number here silently invalidates every shared seed and every save on disk.

import { describe, expect, it } from 'vitest';
import { chunkRng, fbm2, hash2, hash3, mulberry32, pick, randInt, randRange, valueNoise2 } from '../../src/core/rng';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const first = Array.from({ length: 16 }, () => a());
    const second = Array.from({ length: 16 }, () => b());
    expect(first).toEqual(second);
  });

  it('stays inside [0,1)', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 5000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces different streams for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('survives seed 0 and an unsigned-overflowing seed', () => {
    expect(Number.isFinite(mulberry32(0)())).toBe(true);
    expect(Number.isFinite(mulberry32(0xffffffff)())).toBe(true);
  });

  // Golden values. If these move, every seed anyone has ever shared now builds
  // a different world — that is a deliberate decision, not a refactor.
  it('matches its recorded output', () => {
    const rng = mulberry32(1234);
    const got = [rng(), rng(), rng(), rng()].map((n) => +n.toFixed(10));
    expect(got).toEqual([0.0732949781, 0.7034119898, 0.9028560191, 0.9705493662]);
  });
});

describe('hash2 / hash3', () => {
  it('returns a 32-bit unsigned integer', () => {
    for (const [x, y] of [[0, 0], [-5, 12], [1e6, -1e6], [3, 4]]) {
      const h = hash2(1234, x, y);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('separates neighbouring chunks', () => {
    const seen = new Set<number>();
    for (let x = -8; x <= 8; x++) for (let y = -8; y <= 8; y++) seen.add(hash2(1234, x, y));
    // 289 coordinates; a hash that collides more than a handful of times would
    // put the same room next to itself all over the map.
    expect(seen.size).toBeGreaterThan(280);
  });

  it('is not symmetric in its arguments', () => {
    expect(hash2(1234, 3, 7)).not.toBe(hash2(1234, 7, 3));
    expect(hash3(1234, 1, 2, 3)).not.toBe(hash3(1234, 3, 2, 1));
  });

  it('matches its recorded output', () => {
    expect(hash2(1234, 5, -3)).toBe(3608835635);
    expect(hash3(1234, 5, -3, 7)).toBe(587912884);
  });
});

describe('chunkRng', () => {
  it('gives every chunk its own stream, reproducibly', () => {
    expect(chunkRng(1234, 2, 3)()).toBe(chunkRng(1234, 2, 3)());
    expect(chunkRng(1234, 2, 3)()).not.toBe(chunkRng(1234, 3, 2)());
  });

  it('separates the salted streams of one chunk', () => {
    expect(chunkRng(1234, 2, 3, 0)()).not.toBe(chunkRng(1234, 2, 3, 1)());
  });
});

describe('valueNoise2 / fbm2', () => {
  it('stays in [0,1]', () => {
    for (let i = 0; i < 500; i++) {
      const x = (i % 25) * 0.37 - 4;
      const y = Math.floor(i / 25) * 0.41 - 4;
      expect(valueNoise2(7, x, y)).toBeGreaterThanOrEqual(0);
      expect(valueNoise2(7, x, y)).toBeLessThanOrEqual(1);
      expect(fbm2(7, x, y)).toBeGreaterThanOrEqual(0);
      expect(fbm2(7, x, y)).toBeLessThanOrEqual(1);
    }
  });

  it('is continuous across integer boundaries', () => {
    // A seam here is a visible band running through the world geometry.
    const left = valueNoise2(7, 3 - 1e-6, 2.25);
    const right = valueNoise2(7, 3 + 1e-6, 2.25);
    expect(Math.abs(left - right)).toBeLessThan(1e-4);
  });

  it('lands exactly on the lattice value at integer coordinates', () => {
    expect(valueNoise2(7, 4, 9)).toBeCloseTo(hash2(7, 4, 9) / 4294967296, 12);
  });

  it('actually varies over the plane', () => {
    const samples = Array.from({ length: 64 }, (_, i) => fbm2(7, i * 0.6, i * 0.31));
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.15);
  });
});

describe('pick / randRange / randInt', () => {
  it('picks in range and never off the end of the array', () => {
    const arr = ['a', 'b', 'c'] as const;
    const rng = mulberry32(3);
    for (let i = 0; i < 1000; i++) expect(arr).toContain(pick(rng, arr));
  });

  it('keeps randRange inside its bounds', () => {
    const rng = mulberry32(4);
    for (let i = 0; i < 1000; i++) {
      const v = randRange(rng, -2, 5);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(5);
    }
  });

  it('keeps randInt integral and half-open', () => {
    const rng = mulberry32(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = randInt(rng, 2, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });
});
