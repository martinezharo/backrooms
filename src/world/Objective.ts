// Where the last floor's objective lives: three fuses scattered far apart and
// the exit portal, all derived from the seed alone so every chunk can decide on
// its own whether it holds something, without any global state.
//
// Only Level ! ever asks. Every floor above it has its own way down, and none
// of them is a fuse hunt.

import { hash3, mulberry32 } from '../core/rng';

export interface FuseSite { cx: number; cz: number; index: number; }
export interface ExitSite { cx: number; cz: number; onWall: boolean; }
export interface ObjectiveLayout { fuses: FuseSite[]; exit: ExitSite; }

export const FUSE_COUNT = 3;

/** chunk-distance rings (1 chunk = 32 m) */
const FUSE_MIN = 6;
const FUSE_MAX = 9;
const EXIT_MIN = 4;
const EXIT_MAX = 6;

const cache = new Map<number, ObjectiveLayout>();

/**
 * Nearest chunk to the ideal ring position whose biome passes the filter.
 * Spirals outward deterministically so the answer never depends on load order.
 */
function pickChunk(
  angle: number,
  dist: number,
  taken: Set<string>,
): { cx: number; cz: number } {
  const ix = Math.round(Math.cos(angle) * dist);
  const iz = Math.round(Math.sin(angle) * dist);
  for (let r = 0; r < 12; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = ix + dx;
        const cz = iz + dz;
        if (cx === 0 && cz === 0) continue;      // never on the spawn chunk
        if (taken.has(`${cx},${cz}`)) continue;
        taken.add(`${cx},${cz}`);
        return { cx, cz };
      }
    }
  }
  taken.add(`${ix},${iz}`);
  return { cx: ix, cz: iz };
}

export function objectiveLayout(seed: number): ObjectiveLayout {
  const hit = cache.get(seed);
  if (hit) return hit;

  const rng = mulberry32(hash3(seed, 0x5e1ec7, 0x0bec7, 0x11));
  const base = rng() * Math.PI * 2;
  const taken = new Set<string>();

  // The three fuses sit roughly 120° apart so you always cross new ground.
  const fuses: FuseSite[] = [];
  for (let i = 0; i < FUSE_COUNT; i++) {
    const angle = base + (i * 2 * Math.PI) / FUSE_COUNT + (rng() - 0.5) * 0.6;
    const dist = FUSE_MIN + rng() * (FUSE_MAX - FUSE_MIN);
    const c = pickChunk(angle, dist, taken);
    fuses.push({ ...c, index: i });
  }

  // The way out is closer than the fuses and in its own direction — so the
  // last stretch is a run back through ground you already know.
  const exitAngle = base + Math.PI / FUSE_COUNT + (rng() - 0.5) * 0.4;
  const exitDist = EXIT_MIN + rng() * (EXIT_MAX - EXIT_MIN);
  const e = pickChunk(exitAngle, exitDist, taken);
  const onWall = mulberry32(hash3(seed, e.cx, e.cz, 0x9d1c5f))() < 0.5;

  const layout: ObjectiveLayout = { fuses, exit: { ...e, onWall } };
  cache.set(seed, layout);
  return layout;
}

export function fuseSiteAt(seed: number, cx: number, cz: number): FuseSite | null {
  return objectiveLayout(seed).fuses.find((f) => f.cx === cx && f.cz === cz) ?? null;
}

export function isExitChunk(seed: number, cx: number, cz: number): boolean {
  const e = objectiveLayout(seed).exit;
  return e.cx === cx && e.cz === cz;
}
