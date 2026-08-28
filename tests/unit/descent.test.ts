// Every floor's way down is derived from the seed, and each chunk decides on
// its own whether it holds the prop. A floor whose exit chunk never resolves,
// or whose keypad code does not match the digits sprayed on the wall, is a run
// that cannot be finished — the worst class of bug this game has.

import { describe, expect, it } from 'vitest';
import { LAST_DEPTH } from '../../src/world/Biomes';
import {
  cellCentre, chunkCentre, descentKind, descentLayout, isDescentChunk, subSiteHere,
} from '../../src/world/Descent';
import { CELL, CHUNK } from '../../src/core/constants';

const SEEDS = [0, 1, 1234, 42, 987654321, 0xffffffff];
const DEPTHS = [0, 1, 2, 3, 4, 5];

describe('descentKind', () => {
  it('gives each floor its own toll', () => {
    expect(DEPTHS.map(descentKind)).toEqual([
      'softwall', 'shutter', 'drain', 'hatch', 'door', 'portal',
    ]);
  });

  it('only the last floor gets the portal — everything above it goes down', () => {
    for (let d = 0; d < LAST_DEPTH; d++) expect(descentKind(d)).not.toBe('portal');
    expect(descentKind(LAST_DEPTH)).toBe('portal');
  });

  it('clamps out-of-range depths instead of returning undefined', () => {
    expect(descentKind(-3)).toBe('softwall');
    expect(descentKind(99)).toBe('portal');
  });
});

describe('descentLayout', () => {
  it('is deterministic for a seed and a floor', () => {
    for (const seed of SEEDS) {
      for (const d of DEPTHS) expect(descentLayout(seed, d)).toEqual(descentLayout(seed, d));
    }
  });

  it('gives each floor of a seed its own way down', () => {
    for (const seed of SEEDS) {
      const keys = DEPTHS.map((d) => JSON.stringify(descentLayout(seed, d)));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('never puts the way down on the chunk you arrived in', () => {
    for (const seed of SEEDS) {
      for (const d of DEPTHS) {
        const { exit, sub } = descentLayout(seed, d);
        expect(`${exit.cx},${exit.cz}`).not.toBe('0,0');
        if (sub) expect(`${sub.cx},${sub.cz}`).not.toBe('0,0');
      }
    }
  });

  it('keeps the exit on a walkable ring', () => {
    for (const seed of SEEDS) {
      for (const d of DEPTHS) {
        const { exit } = descentLayout(seed, d);
        const dist = Math.hypot(exit.cx, exit.cz);
        expect(dist).toBeGreaterThan(2);   // ring is 4..7 chunks
        expect(dist).toBeLessThan(10);
      }
    }
  });

  it('never lets the unlock and the way down fight over one chunk', () => {
    for (const seed of SEEDS) {
      for (const d of DEPTHS) {
        const { exit, sub } = descentLayout(seed, d);
        if (sub) expect(`${sub.cx},${sub.cz}`).not.toBe(`${exit.cx},${exit.cz}`);
      }
    }
  });

  it('only gives an unlock to the two floors that have one', () => {
    for (const seed of SEEDS) {
      expect(descentLayout(seed, 0).sub).toBeNull();
      expect(descentLayout(seed, 1).sub).toBeNull();
      expect(descentLayout(seed, 2).sub?.kind).toBe('valve');
      expect(descentLayout(seed, 3).sub).toBeNull();
      expect(descentLayout(seed, 4).sub?.kind).toBe('code');
      expect(descentLayout(seed, 5).sub).toBeNull();
    }
  });

  it('writes a four-digit code that never opens with a zero', () => {
    // A zero sprayed on a wall reads as an O and the keypad refuses it.
    for (const seed of SEEDS) {
      for (const d of DEPTHS) {
        expect(descentLayout(seed, d).code).toMatch(/^[1-9]\d{3}$/);
      }
    }
  });

  it('does not reuse one code across every floor of a seed', () => {
    for (const seed of SEEDS) {
      const codes = DEPTHS.map((d) => descentLayout(seed, d).code);
      expect(new Set(codes).size).toBeGreaterThan(1);
    }
  });

  it('returns integer chunk coordinates', () => {
    for (const seed of SEEDS) {
      for (const d of DEPTHS) {
        const { exit, sub } = descentLayout(seed, d);
        for (const s of sub ? [exit, sub] : [exit]) {
          expect(Number.isInteger(s.cx)).toBe(true);
          expect(Number.isInteger(s.cz)).toBe(true);
        }
      }
    }
  });
});

describe('the per-chunk lookups agree with the layout', () => {
  it('marks the descent chunk and nothing beside it', () => {
    for (const seed of SEEDS) {
      for (const d of DEPTHS) {
        const { exit } = descentLayout(seed, d);
        expect(isDescentChunk(seed, d, exit.cx, exit.cz)).toBe(true);
        expect(isDescentChunk(seed, d, exit.cx + 1, exit.cz)).toBe(false);
        expect(isDescentChunk(seed, d, 0, 0)).toBe(false);
      }
    }
  });

  it('finds the unlock only where the layout put it', () => {
    for (const seed of SEEDS) {
      for (const d of [2, 4]) {
        const sub = descentLayout(seed, d).sub!;
        expect(subSiteHere(seed, d, sub.cx, sub.cz)).toBe(sub.kind);
        expect(subSiteHere(seed, d, sub.cx + 1, sub.cz)).toBeNull();
      }
      expect(subSiteHere(seed, 0, 0, 0)).toBeNull();
    }
  });

  it('does not put the unlock on the descent chunk', () => {
    for (const seed of SEEDS) {
      for (const d of [2, 4]) {
        const sub = descentLayout(seed, d).sub!;
        expect(isDescentChunk(seed, d, sub.cx, sub.cz)).toBe(false);
      }
    }
  });
});

describe('chunk geometry', () => {
  it('centres a chunk on its own footprint', () => {
    expect(chunkCentre(0, 0).toArray()).toEqual([CHUNK / 2, 0, CHUNK / 2]);
    expect(chunkCentre(-1, 2).toArray()).toEqual([-CHUNK / 2, 0, CHUNK * 2 + CHUNK / 2]);
  });

  it('centres a cell inside its chunk', () => {
    expect(cellCentre(0, 0, 0, 0)).toEqual([CELL / 2, CELL / 2]);
    const [x, z] = cellCentre(1, -1, 15, 15);
    expect(x).toBeGreaterThan(CHUNK);
    expect(x).toBeLessThan(CHUNK * 2);
    expect(z).toBeGreaterThan(-CHUNK);
    expect(z).toBeLessThan(0);
  });
});
