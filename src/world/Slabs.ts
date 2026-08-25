// Where each floor sits in world Y.
//
// A level used to be the only thing built at any moment, so every chunk could
// put its floor at y = 0 and be right. Now two of them can be standing at once
// and they need somewhere to stand: a depth owns a slab of world Y, and its
// chunks are baked into that slab at generation time rather than offset by a
// group transform. Baking is what keeps the rest of the codebase honest —
// c.floor, c.ceil, c.waterY and every prop's y come out of generateChunk
// already in world coordinates, so nothing downstream has to know slabs exist.
//
// The only code that does is whatever has to pick a slab from a height, which
// is what slabForY is for.

import { CELL, CHUNK } from '../core/constants';
import { biomeForDepth, BIOMES, DEPTH_COUNT, LAST_DEPTH } from './Biomes';
import type { ChunkData } from './Chunk';
import { BASIN_FLOOR, descentCell, descentKind, descentLayout } from './Descent';

/**
 * Structural gap between one floor's lowest carve and the next floor's ceiling.
 * Generous on purpose: it is the space the connections are built in, and the
 * deepest thing any floor digs into itself is Level 37's basin at -4.6.
 */
export const SLAB_GAP = 12;

/** Baked once — six numbers, and they never change during a run. */
const BASE: number[] = (() => {
  const out = [0];
  for (let d = 1; d < DEPTH_COUNT; d++) {
    out[d] = out[d - 1] - (BIOMES[biomeForDepth(d)].ceiling + SLAB_GAP);
  }
  return out;
})();

/** World Y of a floor's ground plane. Depth 0 is at zero, and always was. */
export function baseY(depth: number): number {
  return BASE[Math.max(0, Math.min(LAST_DEPTH, depth))];
}

/**
 * The boundary between depth d-1 and depth d, halfway down the structural gap
 * above d's ceiling. Nothing either floor carves ever reaches it.
 */
function boundary(depth: number): number {
  return baseY(depth) + BIOMES[biomeForDepth(depth)].ceiling + SLAB_GAP / 2;
}

/**
 * Which floor a world height belongs to. Used to pick the slab a spatial query
 * should answer from — inside a connection this is also what decides the moment
 * the player stops being on one floor and starts being on the next.
 */
export function slabForY(y: number): number {
  for (let d = LAST_DEPTH; d > 0; d--) {
    if (y < boundary(d)) return d;
  }
  return 0;
}

/**
 * Move a freshly generated chunk into its slab. Everything absolute shifts;
 * ceilDrop is a depth below the ceiling, not a height, so it stays put.
 */
export function bakeSlab(c: ChunkData): void {
  const dy = baseY(c.depth);
  c.base = dy;
  if (dy === 0) return;

  c.ceil += dy;
  if (c.waterY !== null) c.waterY += dy;
  for (let k = 0; k < c.floor.length; k++) c.floor[k] += dy;

  for (const l of c.lights) l.y += dy;
  for (const t of c.taps) t.y += dy;
  for (const g of c.graffiti) g.y += dy;
  for (const s of c.itemSpawns) s.y += dy;
  for (const v of c.vending) v.y += dy;
  for (const car of c.cars) car.y += dy;
  if (c.pedestal) c.pedestal.y += dy;
  if (c.portal) c.portal.y += dy;
  if (c.sub) c.sub.y += dy;
  if (c.descent) {
    c.descent.y += dy;
    c.descent.ty += dy;
  }
}

// ------------------------------------------------------------------ shafts

/**
 * A hole joining two slabs: the drain at the bottom of Level 37's deep end and
 * the pipe it hangs on, which comes out of Level 7's ceiling and keeps going
 * until it is under the water down there.
 *
 * It is one cell wide, which is what makes it cheap: containment inside the
 * pipe is the four wall edges of that cell, so the existing circle-vs-AABB
 * resolver does the work and nothing needs a cylinder primitive.
 */
export interface ShaftSpec {
  /** the cell it occupies, in global cell coordinates */
  gi: number;
  gj: number;
  /** centre of that cell */
  x: number;
  z: number;
  /** inner radius of the pipe */
  radius: number;
  /** world Y of the mouth in the upper slab (the drain) */
  top: number;
  /** world Y of the mouth in the lower slab, under its water */
  bottom: number;
  upper: number;
  lower: number;
}

/** Metres the pipe hangs below the lower floor's water surface. */
const PIPE_SUBMERSION = 2;

/**
 * The shaft under Level 37's drain, derived from the drain's own position so
 * the two can never disagree about where the hole is.
 */
export function shaftFromDrain(x: number, z: number, drainY: number, upper: number): ShaftSpec {
  const lower = upper + 1;
  const water = BIOMES[biomeForDepth(lower)].waterLevel;
  const bottomLocal = (water ?? 0) - PIPE_SUBMERSION;
  return {
    gi: Math.floor(x / CELL),
    gj: Math.floor(z / CELL),
    x, z,
    radius: 0.92,
    top: drainY,
    bottom: baseY(lower) + bottomLocal,
    upper,
    lower,
  };
}

/** Is this height inside the pipe proper — past the mouth at either end? */
export function insidePipe(s: ShaftSpec, y: number): boolean {
  return y < s.top && y > s.bottom;
}

/**
 * The shaft under a floor, if that floor's way down is one. Only the drain is
 * a shaft so far — the ramps and stairwells are carved into the slabs
 * themselves and need nothing here.
 *
 * Pure in (seed, upper), so both floors it joins can place their half of it
 * without either having to be built first.
 */
export function shaftFor(seed: number, upper: number): ShaftSpec | null {
  if (upper < 0 || upper >= LAST_DEPTH) return null;
  if (descentKind(upper) !== 'drain') return null;
  const { exit } = descentLayout(seed, upper);
  const { i, j } = descentCell(seed, upper);
  const x = exit.cx * CHUNK + (i + 0.5) * CELL;
  const z = exit.cz * CHUNK + (j + 0.5) * CELL;
  return shaftFromDrain(x, z, baseY(upper) + BASIN_FLOOR, upper);
}
