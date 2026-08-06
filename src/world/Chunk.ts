// Deterministic per-chunk layout generation.
//
// A chunk is CELLS x CELLS cells. Walls live on cell edges:
//   wallsV[lineX * CELLS + j] — wall on the vertical line x=lineX, segment j (17 lines)
//   wallsH[lineZ * CELLS + i] — wall on the horizontal line z=lineZ, segment i
// Border lines (0 and 16) are derived from an "edge contract" hashed from world
// coordinates, so both neighbouring chunks compute identical border walls/doors.
//
// A chunk belongs to exactly one level: the whole floor is one biome, and what
// varies inside it is furniture, not geography.

import * as THREE from 'three';
import { BOTTLE_CAPACITY, CELLS, CELL, CHUNK, WALL_THICKNESS } from '../core/constants';
import { chunkRng, hash3, mulberry32, randInt, Rng } from '../core/rng';
import { GRAFFITI_COUNT } from '../rendering/Textures';
import { BiomeId, BIOMES, biomeForDepth, LAST_DEPTH } from './Biomes';
import { DescentSpot, SubSpot, isDescentChunk, subSiteHere } from './Descent';
import { fuseSiteAt, isExitChunk, objectiveLayout } from './Objective';

export interface LightFixture {
  x: number; y: number; z: number; // world position of the panel
  broken: boolean;
  flicker: boolean;
  phase: number;
  speed: number;
  /** long fluorescent tube instead of a square ceiling panel */
  strip?: boolean;
}

export interface TapSpot { x: number; y: number; z: number; angle: number; }
/**
 * A tag sprayed on a wall face by someone who got here first. `angle` is the
 * yaw that turns the decal's local +z into the direction it faces.
 */
export interface GraffitiSpot {
  x: number; y: number; z: number;
  angle: number;
  variant: number;
  size: number;
}
export interface TableSpot { x: number; z: number; }
export interface ItemSpawn {
  id: string; itemId: string; x: number; y: number; z: number;
  /** bottles only: thirst points already in it when found */
  water?: number;
}
/** Plinth holding one of the three fuses. */
export interface PedestalSpot { x: number; y: number; z: number; }
/** Almond water machine — crouch-free instant drink, a few servings only. */
export interface VendingSpot { x: number; y: number; z: number; angle: number; id: string; }
/**
 * A car, abandoned in its bay with the handbrake on. Decoration you can lean on
 * and, on Level 1, something to hit until it screams.
 */
export interface CarSpot {
  id: string;
  x: number; y: number; z: number;
  /** the long axis of the body */
  angle: number;
  paint: number;
  /** parked upside down on the ceiling, which happens on the last floor */
  inverted: boolean;
}
/** Painted bay markings on the slab. */
export interface BaySpot { x: number; z: number; angle: number; }
/**
 * The way out. `onWall` portals hang on a wall face and still look straight
 * down onto the real world — down here and down out there are not the same
 * direction, and the portal does not care.
 */
export interface PortalSpot {
  x: number; y: number; z: number;
  onWall: boolean;
  /** facing direction of a wall portal (radians about Y) */
  angle: number;
  radius: number;
}

/** solid[k] === SOLID_PROP: blocked, but something else is already drawn there. */
export const SOLID_PROP = 2;

export interface ChunkData {
  cx: number;
  cz: number;
  depth: number;
  biome: BiomeId;
  ceil: number;
  waterY: number | null;
  wallsV: Uint8Array;
  wallsH: Uint8Array;
  solid: Uint8Array;       // solid cells — unwalkable; SOLID_PROP = don't draw
  floor: Float32Array;     // per-cell floor height
  ceilDrop: Float32Array;  // per-cell soffit: how far the ceiling hangs below c.ceil
  water: Uint8Array;       // per-cell water flag
  lights: LightFixture[];
  taps: TapSpot[];
  graffiti: GraffitiSpot[];
  tables: TableSpot[];
  cars: CarSpot[];
  bays: BaySpot[];
  itemSpawns: ItemSpawn[];
  pedestal: PedestalSpot | null;
  portal: PortalSpot | null;
  descent: DescentSpot | null;
  sub: SubSpot | null;
  vending: VendingSpot[];
  group: THREE.Group | null;          // built scene subtree (set by ChunkBuilder)
  waterMesh: THREE.Mesh | null;       // moves when a level floods
  flickerPanels: { mesh: THREE.Mesh; light: LightFixture }[];
}

const N = CELLS;
const idx = (i: number, j: number) => j * N + i;

/**
 * Is this cell deep enough to swim, wade or drown in? Two levels carry water
 * that only ever wets the floor, and nothing that cares about water — item
 * spawns, enemy spawns, the player's lungs — should count a puddle.
 */
export function flooded(c: ChunkData, k: number): boolean {
  return !!c.water[k] && c.waterY !== null && c.waterY > c.floor[k] + 0.4;
}

/** Border doors per biome: how many gaps, and how wide. */
const BORDER: Record<BiomeId, [doors: number, width: number]> = {
  [BiomeId.Level0]: [4, 2],
  [BiomeId.Level1]: [6, 4],
  [BiomeId.Level37]: [5, 3],
  [BiomeId.Level7]: [6, 3],
  [BiomeId.Level2]: [2, 1],
  [BiomeId.LevelRun]: [3, 2],
};

function borderLine(
  seed: number,
  axis: 0 | 1, // 0 = V, 1 = H
  gLine: number,
  strip: number,
  biome: BiomeId,
): Uint8Array {
  const rng = mulberry32(hash3(seed ^ (axis === 0 ? 0x51ed270b : 0x2c9277b5), gLine, strip, 7));
  const line = new Uint8Array(N).fill(1);
  const [doors, width] = BORDER[biome];
  for (let d = 0; d < doors; d++) {
    const p = randInt(rng, 0, N);
    for (let w = 0; w < width; w++) {
      const q = p + w;
      if (q < N) line[q] = 0;
    }
  }
  return line;
}

function doorCellsOfLine(line: Uint8Array): number[] {
  const out: number[] = [];
  for (let k = 0; k < N; k++) if (!line[k]) out.push(k);
  return out;
}

/** Smallest room side, in cells (3 cells = 6 m). */
const MIN_ROOM = 3;

function setWallSpan(c: ChunkData, axis: 0 | 1, line: number, from: number, to: number) {
  for (let k = from; k < to; k++) {
    if (axis === 0) c.wallsV[line * N + k] = 1;
    else c.wallsH[line * N + k] = 1;
  }
}

/** Knock a doorless opening (1-2 cells wide) out of a wall span. */
function carveDoorway(rng: Rng, c: ChunkData, axis: 0 | 1, line: number, from: number, to: number) {
  const width = rng() < 0.28 ? 2 : 1;
  const p = randInt(rng, from, Math.max(from + 1, to - width + 1));
  for (let w = 0; w < width && p + w < to; w++) {
    if (axis === 0) c.wallsV[line * N + p + w] = 0;
    else c.wallsH[line * N + p + w] = 0;
  }
}

/**
 * Level 0 layout: recursively partition the chunk into rooms. Every split drops
 * a full wall and then punches one or two doorless openings through it, so the
 * result is a connected warren of rooms and corridors instead of one big hall
 * with loose partitions floating in it. Splits occasionally lay down two
 * parallel walls a cell apart, which reads as a corridor with rooms off it.
 */
function bspRooms(rng: Rng, c: ChunkData, i0: number, j0: number, i1: number, j1: number, depth: number) {
  const w = i1 - i0;
  const h = j1 - j0;
  const canV = w >= MIN_ROOM * 2;
  const canH = h >= MIN_ROOM * 2;
  if (!canV && !canH) return;
  // Stop early now and then so room sizes spread out instead of all converging
  // on the minimum — a few wide bays among the small rooms. Only small rects
  // get the reprieve; anything large keeps subdividing or the chunk reads as a
  // hall again.
  if (depth >= 2 && w * h <= 42 && rng() < 0.5) return;

  const vertical = canV && canH
    ? (w > h + 1 ? true : h > w + 1 ? false : rng() < 0.5)
    : canV;
  const axis: 0 | 1 = vertical ? 0 : 1;

  // The wall runs across the rect's other dimension.
  const span0 = vertical ? j0 : i0;
  const span1 = vertical ? j1 : i1;
  const lo = (vertical ? i0 : j0) + MIN_ROOM;
  const hi = (vertical ? i1 : j1) - MIN_ROOM; // inclusive
  const line = randInt(rng, lo, hi + 1);

  // A corridor needs a spare cell between the two halves.
  const corridor = line < hi && rng() < 0.3;
  const doors = () => 1 + (span1 - span0 >= 8 && rng() < 0.5 ? 1 : 0);

  setWallSpan(c, axis, line, span0, span1);
  for (let d = doors(); d > 0; d--) carveDoorway(rng, c, axis, line, span0, span1);

  let far = line;
  if (corridor) {
    far = line + 1;
    setWallSpan(c, axis, far, span0, span1);
    for (let d = doors(); d > 0; d--) carveDoorway(rng, c, axis, far, span0, span1);
  }

  if (vertical) {
    bspRooms(rng, c, i0, j0, line, j1, depth + 1);
    bspRooms(rng, c, far, j0, i1, j1, depth + 1);
  } else {
    bspRooms(rng, c, i0, j0, i1, line, depth + 1);
    bspRooms(rng, c, i0, far, i1, j1, depth + 1);
  }
}

/** Carve straight wall runs with random gaps (Level 0 partitions). */
function wallRuns(rng: Rng, wallsV: Uint8Array, wallsH: Uint8Array, count: number, gapChance: number) {
  for (let r = 0; r < count; r++) {
    const vertical = rng() < 0.5;
    const len = randInt(rng, 3, 9);
    if (vertical) {
      const lineX = randInt(rng, 2, N - 1);
      const j0 = randInt(rng, 0, N - len);
      for (let j = j0; j < j0 + len; j++) {
        if (rng() > gapChance) wallsV[lineX * N + j] = 1;
      }
    } else {
      const lineZ = randInt(rng, 2, N - 1);
      const i0 = randInt(rng, 0, N - len);
      for (let i = i0; i < i0 + len; i++) {
        if (rng() > gapChance) wallsH[lineZ * N + i] = 1;
      }
    }
  }
}

/**
 * Ensure every open cell is reachable from a border door. Carves walls between
 * reached/unreached open cells; seals truly isolated pockets into solid.
 */
function fixConnectivity(c: ChunkData, seedCells: number[]) {
  const reached = new Uint8Array(N * N);
  const queue: number[] = [];
  for (const s of seedCells) {
    if (!c.solid[s] && !reached[s]) { reached[s] = 1; queue.push(s); }
  }
  const flood = () => {
    while (queue.length) {
      const cur = queue.pop()!;
      const i = cur % N;
      const j = (cur / N) | 0;
      // -x
      if (i > 0 && !c.wallsV[i * N + j] && !c.solid[cur - 1] && !reached[cur - 1]) { reached[cur - 1] = 1; queue.push(cur - 1); }
      // +x
      if (i < N - 1 && !c.wallsV[(i + 1) * N + j] && !c.solid[cur + 1] && !reached[cur + 1]) { reached[cur + 1] = 1; queue.push(cur + 1); }
      // -z
      if (j > 0 && !c.wallsH[j * N + i] && !c.solid[cur - N] && !reached[cur - N]) { reached[cur - N] = 1; queue.push(cur - N); }
      // +z
      if (j < N - 1 && !c.wallsH[(j + 1) * N + i] && !c.solid[cur + N] && !reached[cur + N]) { reached[cur + N] = 1; queue.push(cur + N); }
    }
  };
  flood();

  for (let guard = 0; guard < N * N; guard++) {
    let carved = false;
    for (let j = 0; j < N && !carved; j++) {
      for (let i = 0; i < N && !carved; i++) {
        const cur = idx(i, j);
        if (c.solid[cur] || reached[cur]) continue;
        // unreached open cell — try to knock a wall through to a reached neighbour
        if (i > 0 && !c.solid[cur - 1] && reached[cur - 1]) { c.wallsV[i * N + j] = 0; carved = true; }
        else if (i < N - 1 && !c.solid[cur + 1] && reached[cur + 1]) { c.wallsV[(i + 1) * N + j] = 0; carved = true; }
        else if (j > 0 && !c.solid[cur - N] && reached[cur - N]) { c.wallsH[j * N + i] = 0; carved = true; }
        else if (j < N - 1 && !c.solid[cur + N] && reached[cur + N]) { c.wallsH[(j + 1) * N + i] = 0; carved = true; }
        if (carved) { reached[cur] = 1; queue.push(cur); flood(); }
      }
    }
    if (!carved) break;
  }
  // Seal anything still unreachable (walled in by pillars on all sides).
  for (let k = 0; k < N * N; k++) {
    if (!c.solid[k] && !reached[k]) c.solid[k] = 1;
  }
}

// No torches: you start the run holding one, so finding more would be noise.
const ITEM_TABLE: { id: string; w: number }[] = [
  { id: 'knife', w: 0.14 },
  { id: 'pipe', w: 0.14 },
  { id: 'bottle', w: 0.22 },
  { id: 'wrench', w: 0.1 },
  { id: 'extinguisher', w: 0.07 },
  { id: 'pistol', w: 0.04 },
  { id: 'ammo', w: 0.14 },
  { id: 'battery', w: 0.15 },
];

function rollItem(rng: Rng): string {
  let r = rng();
  for (const e of ITEM_TABLE) {
    r -= e.w;
    if (r <= 0) return e.id;
  }
  return 'bottle';
}

/**
 * The paint that was on the cars the day the level took them. Muted, because
 * whatever light is down here has been eating the pigment for a while.
 */
const CAR_PAINT = [
  0x9aa0a6, 0x6d747c, 0x2f3438, 0xb8b2a4, 0x7c3a34,
  0x2f4a5c, 0x4c5a3e, 0xa08a4a, 0x8f9294,
];

// -------------------------------------------------------------- site tools

/**
 * How much the service ramp falls per 2 m bay. Shallow enough to walk without
 * the step-up rule fighting you, steep enough that a dozen bays put the bottom
 * of it properly under the floor you are standing on.
 */
const RAMP_FALL = 0.28;

/** Flat, dry, wall-free floor around a site so it always reads as a clearing. */
function carveApron(c: ChunkData, si: number, sj: number, r: number, floorY = 0): void {
  for (let dj = -r; dj <= r; dj++) {
    for (let di = -r; di <= r; di++) {
      const i = si + di;
      const j = sj + dj;
      if (i < 0 || i >= N || j < 0 || j >= N) continue;
      const k = idx(i, j);
      c.solid[k] = 0;
      c.floor[k] = floorY;
      c.water[k] = 0;
      c.wallsV[i * N + j] = 0;
      c.wallsV[(i + 1) * N + j] = 0;
      c.wallsH[j * N + i] = 0;
      c.wallsH[(j + 1) * N + i] = 0;
    }
  }
}

/** A free-standing partition, open at both ends, for hanging things on. */
function standingWall(c: ChunkData, axis: 0 | 1, line: number, from: number, to: number): void {
  for (let k = from; k <= to; k++) {
    if (k < 0 || k >= N) continue;
    if (axis === 0) c.wallsV[line * N + k] = 1;
    else c.wallsH[line * N + k] = 1;
  }
}

export function generateChunk(seed: number, depth: number, cx: number, cz: number): ChunkData {
  const biome = biomeForDepth(depth);
  const def = BIOMES[biome];
  const rng = chunkRng(seed, cx, cz);

  const c: ChunkData = {
    cx, cz, depth, biome,
    ceil: def.ceiling,
    waterY: def.waterLevel,
    wallsV: new Uint8Array((N + 1) * N),
    wallsH: new Uint8Array((N + 1) * N),
    solid: new Uint8Array(N * N),
    floor: new Float32Array(N * N),
    ceilDrop: new Float32Array(N * N),
    water: new Uint8Array(N * N),
    lights: [],
    taps: [],
    graffiti: [],
    tables: [],
    cars: [],
    bays: [],
    itemSpawns: [],
    pedestal: null,
    portal: null,
    descent: null,
    sub: null,
    vending: [],
    group: null,
    waterMesh: null,
    flickerPanels: [],
  };

  // ---- border walls from the shared edge contract ----
  const lineW = borderLine(seed, 0, cx * N, cz, biome);
  const lineE = borderLine(seed, 0, (cx + 1) * N, cz, biome);
  const lineN = borderLine(seed, 1, cz * N, cx, biome);
  const lineS = borderLine(seed, 1, (cz + 1) * N, cx, biome);
  for (let k = 0; k < N; k++) {
    c.wallsV[0 * N + k] = lineW[k];
    c.wallsV[N * N + k] = lineE[k];
    c.wallsH[0 * N + k] = lineN[k];
    c.wallsH[N * N + k] = lineS[k];
  }

  // ---- interior layout per level ----
  switch (biome) {
    case BiomeId.Level0: {
      bspRooms(rng, c, 0, 0, N, N, 0);
      // a couple of free-standing stubs so not every room is a clean box
      wallRuns(rng, c.wallsV, c.wallsH, randInt(rng, 1, 4), 0.45);
      const pillars = randInt(rng, 0, 3);
      for (let p = 0; p < pillars; p++) {
        c.solid[idx(randInt(rng, 2, N - 2), randInt(rng, 2, N - 2))] = 1;
      }
      break;
    }
    case BiomeId.Level1: {
      parkingSlab(rng, c, cx, cz);
      break;
    }
    case BiomeId.Level2: {
      // Corridors derived from border doors → tunnels always meet the doors.
      const rows = new Set<number>([...doorCellsOfLine(lineW), ...doorCellsOfLine(lineE)]);
      const cols = new Set<number>([...doorCellsOfLine(lineN), ...doorCellsOfLine(lineS)]);
      if (rng() < 0.6) rows.add(randInt(rng, 1, N - 1));
      if (rng() < 0.6) cols.add(randInt(rng, 1, N - 1));
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          if (!rows.has(j) && !cols.has(i)) c.solid[idx(i, j)] = 1;
        }
      }
      break;
    }
    case BiomeId.Level37: {
      // Open halls with colonnades and sunken pool basins. Every cell carries
      // water: the surface starts below the walkable floor and only shows in
      // the basins — until somebody opens the main valve.
      c.water.fill(1);
      const off = randInt(rng, 1, 4);
      for (let j = off; j < N - 1; j += 5) {
        for (let i = off; i < N - 1; i += 5) {
          c.solid[idx(i, j)] = 1;
        }
      }
      wallRuns(rng, c.wallsV, c.wallsH, randInt(rng, 1, 3), 0.4);
      const basins = randInt(rng, 2, 4);
      for (let b = 0; b < basins; b++) {
        const w = randInt(rng, 4, 9);
        const h = randInt(rng, 4, 9);
        const i0 = randInt(rng, 2, Math.max(3, N - 2 - w));
        const j0 = randInt(rng, 2, Math.max(3, N - 2 - h));
        for (let j = j0; j < Math.min(j0 + h, N - 2); j++) {
          for (let i = i0; i < Math.min(i0 + w, N - 2); i++) {
            const k = idx(i, j);
            c.floor[k] = -1.7;
            c.solid[k] = 0;
            // open up the basin interior + rim
            c.wallsV[i * N + j] = 0;
            c.wallsV[(i + 1) * N + j] = 0;
            c.wallsH[j * N + i] = 0;
            c.wallsH[(j + 1) * N + i] = 0;
          }
        }
      }
      break;
    }
    case BiomeId.Level7: {
      // Flooded open dark rooms, deep enough that the bottom is a dive.
      c.water.fill(1);
      const pillars = randInt(rng, 4, 9);
      for (let p = 0; p < pillars; p++) {
        c.solid[idx(randInt(rng, 1, N - 1), randInt(rng, 1, N - 1))] = 1;
      }
      wallRuns(rng, c.wallsV, c.wallsH, randInt(rng, 2, 5), 0.45);
      // trenches — nothing down here has a flat bottom
      const trenches = randInt(rng, 1, 4);
      for (let t = 0; t < trenches; t++) {
        const w = randInt(rng, 3, 7);
        const h = randInt(rng, 3, 7);
        const i0 = randInt(rng, 1, Math.max(2, N - 1 - w));
        const j0 = randInt(rng, 1, Math.max(2, N - 1 - h));
        for (let j = j0; j < Math.min(j0 + h, N - 1); j++) {
          for (let i = i0; i < Math.min(i0 + w, N - 1); i++) {
            if (!c.solid[idx(i, j)]) c.floor[idx(i, j)] = -1.4;
          }
        }
      }
      break;
    }
    case BiomeId.LevelRun: {
      derangedLobby(rng, c, cx, cz);
      break;
    }
  }

  // Spawn chunk: keep the centre clear.
  if (cx === 0 && cz === 0) {
    for (let j = 6; j <= 9; j++) {
      for (let i = 6; i <= 9; i++) {
        const k = idx(i, j);
        c.solid[k] = 0;
        c.floor[k] = 0;
        if (i > 6) c.wallsV[i * N + j] = 0;
        if (j > 6) c.wallsH[j * N + i] = 0;
      }
    }
  }

  const wx0 = cx * CHUNK;
  const wz0 = cz * CHUNK;
  const cellCenter = (i: number, j: number): [number, number] =>
    [wx0 + (i + 0.5) * CELL, wz0 + (j + 0.5) * CELL];

  // ---- the way down (carved before connectivity so it never seals itself) ----
  let siteCell: { i: number; j: number } | null = null;
  if (isDescentChunk(seed, depth, cx, cz) && depth < LAST_DEPTH) {
    const si = randInt(rng, 6, 10);
    // The car park's service ramp runs most of a chunk before it bottoms out,
    // so its shutter has to stand well into the +z half to leave room behind it.
    const sj = biome === BiomeId.Level1 ? randInt(rng, 11, 14) : randInt(rng, 6, 10);
    siteCell = { i: si, j: sj };
    buildDescentSite(c, si, sj, cellCenter);
  }
  const sub = subSiteHere(seed, depth, cx, cz);
  if (sub) {
    const si = randInt(rng, 5, 11);
    const sj = randInt(rng, 5, 11);
    carveApron(c, si, sj, 2);
    // the wheel and the wall with the digits both need something to hang on
    standingWall(c, 0, si - 1, sj - 1, sj + 1);
    const [sxw, szw] = cellCenter(si, sj);
    c.sub = {
      kind: sub,
      x: wx0 + (si - 1) * CELL + WALL_THICKNESS / 2 + 0.02,
      y: sub === 'valve' ? 1.35 : 1.55,
      z: szw,
      angle: Math.PI / 2,
    };
    c.lights.push({ x: sxw, y: c.ceil - 0.1, z: szw, broken: false, flicker: false, phase: 0, speed: 8 });
  }

  // ---- fuses and the portal: only ever on the last floor ----
  const fuseSite = depth === LAST_DEPTH ? fuseSiteAt(seed, cx, cz) : null;
  const exitHere = depth === LAST_DEPTH && isExitChunk(seed, cx, cz);
  let objectiveCell: { i: number; j: number } | null = null;
  if (fuseSite || exitHere) {
    const si = randInt(rng, 5, 11);
    const sj = randInt(rng, 5, 11);
    objectiveCell = { i: si, j: sj };
    carveApron(c, si, sj, 2);
    if (exitHere && objectiveLayout(seed).exit.onWall) {
      standingWall(c, 0, si - 1, sj - 1, sj + 1);
    }
  }

  // ---- connectivity ----
  const seeds: number[] = [];
  for (const j of doorCellsOfLine(lineW)) seeds.push(idx(0, j));
  for (const j of doorCellsOfLine(lineE)) seeds.push(idx(N - 1, j));
  for (const i of doorCellsOfLine(lineN)) seeds.push(idx(i, 0));
  for (const i of doorCellsOfLine(lineS)) seeds.push(idx(i, N - 1));
  for (const s of seeds) c.solid[s] = 0; // door mouths must stay open

  // A door mouth, an apron or a stairwell can land in the middle of a bay. The
  // hole wins — but the car that was parked there has just stopped being solid,
  // and half a hatchback you can walk through is worse than an empty bay.
  if (c.cars.length) {
    c.cars = c.cars.filter((car) => {
      if (car.inverted) return true;
      const i = Math.floor((car.x - wx0) / CELL);
      const j = Math.round((car.z - wz0) / CELL) - 1;
      if (i < 0 || i >= N || j < 0 || j + 1 >= N) return true;
      return c.solid[idx(i, j)] === SOLID_PROP && c.solid[idx(i, j + 1)] === SOLID_PROP;
    });
  }
  // Dropping the car leaves its other cell still marked SOLID_PROP: blocked,
  // and drawn by nothing. That reads as an invisible box standing in an empty
  // bay, so clear every prop cell no surviving car is actually parked on.
  {
    const parked = new Uint8Array(N * N);
    for (const car of c.cars) {
      if (car.inverted) continue;
      const i = Math.floor((car.x - wx0) / CELL);
      const j = Math.round((car.z - wz0) / CELL) - 1;
      if (i < 0 || i >= N || j < 0 || j + 1 >= N) continue;
      parked[idx(i, j)] = 1;
      parked[idx(i, j + 1)] = 1;
    }
    for (let k = 0; k < N * N; k++) {
      if (c.solid[k] === SOLID_PROP && !parked[k]) c.solid[k] = 0;
    }
  }
  // Bay markings are painted flat on the slab at y=0. Where the ramp has taken
  // the floor out from under one, the paint would hang in the air over the
  // trench, so the bay goes with the floor it was painted on.
  if (c.bays.length) {
    c.bays = c.bays.filter((b) => {
      const i = Math.floor((b.x - wx0) / CELL);
      const j = Math.round((b.z - wz0) / CELL) - 1;
      if (i < 0 || i >= N || j < 0 || j + 1 >= N) return true;
      return c.floor[idx(i, j)] > -0.01 && c.floor[idx(i, j + 1)] > -0.01;
    });
  }

  fixConnectivity(c, seeds);

  // ---- light fixtures ----
  // Level 0 keeps a dense, almost fully working ceiling grid — the horror is
  // the even fluorescent light, not the dark.
  let lightStep = 2, brokenP = 0.03, flickerP = 0.07, strip = false;
  if (biome === BiomeId.Level1) { lightStep = 4; brokenP = 0.32; flickerP = 0.3; strip = true; }
  if (biome === BiomeId.Level2) { lightStep = 4; brokenP = 0.3; flickerP = 0.3; }
  if (biome === BiomeId.Level37) { lightStep = 3; brokenP = 0.05; flickerP = 0.08; }
  if (biome === BiomeId.Level7) { lightStep = 5; brokenP = 0.55; flickerP = 0.3; }
  // The last floor remembers the lobby's ceiling grid and gets most of it wrong.
  if (biome === BiomeId.LevelRun) { lightStep = 2; brokenP = 0.45; flickerP = 0.42; }
  const lightOff = randInt(rng, 0, lightStep);
  for (let j = lightOff; j < N; j += lightStep) {
    for (let i = lightOff; i < N; i += lightStep) {
      const k = idx(i, j);
      if (c.solid[k]) continue;
      if (biome === BiomeId.Level2 && rng() < 0.35) continue;
      const [x, z] = cellCenter(i, j);
      c.lights.push({
        x, z,
        y: c.ceil - 0.1,
        broken: rng() < brokenP,
        flicker: rng() < flickerP,
        phase: rng() * 10,
        speed: 6 + rng() * 14,
        strip,
      });
    }
  }
  // Spawn chunk must have a working light above the player.
  if (cx === 0 && cz === 0) {
    c.lights.push({ x: wx0 + 16, z: wz0 + 16, y: c.ceil - 0.1, broken: false, flicker: false, phase: 0, speed: 8 });
  }

  // ---- taps (dry floors with plumbing) ----
  if (biome === BiomeId.Level0 || biome === BiomeId.Level2 || biome === BiomeId.LevelRun) {
    const tapCount = rng() < 0.55 ? randInt(rng, 1, 3) : 0;
    for (let t = 0; t < tapCount; t++) {
      // find a wall segment with an open cell in front of it
      for (let tries = 0; tries < 30; tries++) {
        const i = randInt(rng, 1, N - 1);
        const j = randInt(rng, 1, N - 1);
        const k = idx(i, j);
        if (c.solid[k] || flooded(c, k)) continue;
        const [cxw, czw] = cellCenter(i, j);
        if (c.wallsV[i * N + j]) {           // wall on west edge, tap faces +x
          c.taps.push({ x: wx0 + i * CELL + 0.14, y: c.floor[k] + 0.95, z: czw, angle: 0 });
          break;
        }
        if (c.wallsV[(i + 1) * N + j]) {     // east edge, faces -x
          c.taps.push({ x: wx0 + (i + 1) * CELL - 0.14, y: c.floor[k] + 0.95, z: czw, angle: Math.PI });
          break;
        }
        if (c.wallsH[j * N + i]) {           // north edge, faces +z
          c.taps.push({ x: cxw, y: c.floor[k] + 0.95, z: wz0 + j * CELL + 0.14, angle: Math.PI / 2 });
          break;
        }
        if (c.wallsH[(j + 1) * N + i]) {     // south edge, faces -z
          c.taps.push({ x: cxw, y: c.floor[k] + 0.95, z: wz0 + (j + 1) * CELL - 0.14, angle: -Math.PI / 2 });
          break;
        }
      }
    }
  }

  // ---- graffiti ----
  // On Level 0 most rooms are untouched and now and then a wall has something
  // scrawled on it. On the last floor everyone who ever came through wrote on
  // everything, and none of it is reassuring.
  const graffitiChance = biome === BiomeId.LevelRun ? 0.9
    : biome === BiomeId.Level0 ? 0.12
      : biome === BiomeId.Level1 ? 0.3 : 0;
  if (rng() < graffitiChance) {
    const tags = biome === BiomeId.LevelRun ? randInt(rng, 3, 7) : (rng() < 0.25 ? 2 : 1);
    for (let t = 0; t < tags; t++) {
      for (let tries = 0; tries < 30; tries++) {
        const i = randInt(rng, 1, N - 1);
        const j = randInt(rng, 1, N - 1);
        const k = idx(i, j);
        if (c.solid[k] || flooded(c, k)) continue;
        const [gx, gz] = cellCenter(i, j);
        // face offset: half the wall thickness, plus a hair to clear z-fighting
        const off = WALL_THICKNESS / 2 + 0.012;
        const y = c.floor[k] + 1.15 + rng() * 0.45;
        const size = 1.2 + rng() * 0.5;
        const variant = randInt(rng, 0, GRAFFITI_COUNT);
        // drift along the wall so tags don't all sit dead-centre on a segment
        const slide = (rng() - 0.5) * (CELL - size) * 0.8;
        if (c.wallsV[i * N + j]) {
          c.graffiti.push({ x: wx0 + i * CELL + off, y, z: gz + slide, angle: Math.PI / 2, variant, size });
        } else if (c.wallsV[(i + 1) * N + j]) {
          c.graffiti.push({ x: wx0 + (i + 1) * CELL - off, y, z: gz + slide, angle: -Math.PI / 2, variant, size });
        } else if (c.wallsH[j * N + i]) {
          c.graffiti.push({ x: gx + slide, y, z: wz0 + j * CELL + off, angle: 0, variant, size });
        } else if (c.wallsH[(j + 1) * N + i]) {
          c.graffiti.push({ x: gx + slide, y, z: wz0 + (j + 1) * CELL - off, angle: Math.PI, variant, size });
        } else {
          continue;
        }
        break;
      }
    }
  }

  // ---- almond water machines (rare, and never underwater) ----
  const vendChance = biome === BiomeId.Level0 || biome === BiomeId.Level2 ? 0.15
    : biome === BiomeId.Level1 || biome === BiomeId.LevelRun ? 0.2 : 0;
  if (rng() < vendChance) {
    for (let tries = 0; tries < 24; tries++) {
      const i = randInt(rng, 1, N - 1);
      const j = randInt(rng, 1, N - 1);
      const k = idx(i, j);
      if (c.solid[k] || flooded(c, k)) continue;
      const [vx, vz] = cellCenter(i, j);
      const id = `${cx},${cz},vend`;
      // angle is the yaw applied to the model; its front face is local +z
      if (c.wallsV[i * N + j]) {
        c.vending.push({ x: wx0 + i * CELL + 0.35, y: c.floor[k], z: vz, angle: Math.PI / 2, id });
      } else if (c.wallsV[(i + 1) * N + j]) {
        c.vending.push({ x: wx0 + (i + 1) * CELL - 0.35, y: c.floor[k], z: vz, angle: -Math.PI / 2, id });
      } else if (c.wallsH[j * N + i]) {
        c.vending.push({ x: vx, y: c.floor[k], z: wz0 + j * CELL + 0.35, angle: 0, id });
      } else if (c.wallsH[(j + 1) * N + i]) {
        c.vending.push({ x: vx, y: c.floor[k], z: wz0 + (j + 1) * CELL - 0.35, angle: Math.PI, id });
      } else {
        continue;
      }
      break;
    }
  }

  // ---- the site's landmark light, and the objective props ----
  if (siteCell) {
    const [sxw, szw] = cellCenter(siteCell.i, siteCell.j);
    c.lights.push({ x: sxw, y: c.ceil - 0.1, z: szw, broken: false, flicker: false, phase: 0, speed: 8 });
  }
  if (objectiveCell) {
    const { i: si, j: sj } = objectiveCell;
    const [sxw, szw] = cellCenter(si, sj);
    // a landmark you can find by light alone
    c.lights.push({ x: sxw, y: c.ceil - 0.1, z: szw, broken: false, flicker: false, phase: 0, speed: 8 });
    if (fuseSite) {
      c.pedestal = { x: sxw, y: 0, z: szw };
    } else {
      const onWall = objectiveLayout(seed).exit.onWall;
      const radius = Math.min(1.05, (c.ceil - 0.55) / 2);
      c.portal = onWall
        ? { x: wx0 + (si - 1) * CELL + 0.14, y: radius + 0.34, z: szw, onWall: true, angle: 0, radius }
        : { x: sxw, y: 0.03, z: szw, onWall: false, angle: 0, radius: 1.15 };
    }
  }

  // ---- tables (the lobby, and what is left of it) ----
  if ((biome === BiomeId.Level0 || biome === BiomeId.LevelRun) && rng() < 0.22) {
    for (let tries = 0; tries < 12; tries++) {
      const i = randInt(rng, 1, N - 1);
      const j = randInt(rng, 1, N - 1);
      if (c.solid[idx(i, j)]) continue;
      const [x, z] = cellCenter(i, j);
      c.tables.push({ x, z });
      break;
    }
  }

  // ---- item spawns ----
  /** Roughly two in five bottles were left with something still in them. */
  const bottleWater = (itemId: string) =>
    itemId === 'bottle' ? (rng() < 0.4 ? BOTTLE_CAPACITY : 0) : undefined;

  // Level 7 is water from wall to wall, so nothing would ever spawn there at
  // all — and a level with no loot in it is a level with nothing in it. What
  // people dropped down there is still down there; it just sank.
  const dryOnly = biome !== BiomeId.Level7;

  const spawnItem = (itemId: string, near?: { i: number; j: number }) => {
    for (let tries = 0; tries < 24; tries++) {
      const i = near ? Math.min(N - 1, Math.max(0, near.i + randInt(rng, -2, 3))) : randInt(rng, 0, N);
      const j = near ? Math.min(N - 1, Math.max(0, near.j + randInt(rng, -2, 3))) : randInt(rng, 0, N);
      const k = idx(i, j);
      if (c.solid[k] || (dryOnly && flooded(c, k))) continue;
      const [x, z] = cellCenter(i, j);
      c.itemSpawns.push({
        id: `${cx},${cz},${c.itemSpawns.length}`,
        itemId,
        x: x + (rng() - 0.5) * 0.8,
        y: c.floor[k] + 0.16,
        z: z + (rng() - 0.5) * 0.8,
        water: bottleWater(itemId),
      });
      return;
    }
  };

  if (c.pedestal) {
    // the fuse sits on its plinth, with a little loot to make the trip pay
    c.itemSpawns.push({
      id: `fuse:${cx},${cz}`, itemId: 'fuse',
      x: c.pedestal.x, y: c.pedestal.y + 1.04, z: c.pedestal.z,
    });
    spawnItem(rollItem(rng));
    if (rng() < 0.5) spawnItem('battery');
  }

  if (cx === 0 && cz === 0 && depth === 0) {
    // Torch and receiver are already in your hands; this is the rest of the kit.
    // No battery here: the torch starts full, so one at your feet was free
    // charge every single run.
    spawnItem('knife', { i: 8, j: 8 });
    spawnItem('bottle', { i: 8, j: 8 });
  } else {
    // Every floor down, the scavenging gets a little better: you need it to.
    if (rng() < 0.38 + depth * 0.03) spawnItem(rollItem(rng));
    if (rng() < 0.1 + depth * 0.03) spawnItem(rollItem(rng));
  }
  // table gets a bonus item on top
  if (c.tables.length && rng() < 0.6) {
    const t = c.tables[0];
    const itemId = rollItem(rng);
    c.itemSpawns.push({
      id: `${cx},${cz},${c.itemSpawns.length}`,
      itemId,
      x: t.x, y: 0.86, z: t.z,
      water: bottleWater(itemId),
    });
  }

  return c;
}

// ------------------------------------------------------------ Level 1 slab

/**
 * The parking. A slab with no rooms on it at all: structural columns on a grid,
 * bays painted in facing rows either side of an aisle, and cars left in most of
 * them. The dread here is the sightline — you can see a very long way and there
 * is never anything at the end of it.
 */
function parkingSlab(rng: Rng, c: ChunkData, cx: number, cz: number): void {
  const period = 7;                       // two bay bands (4 cells) + aisle (3)
  const bandOff = randInt(rng, 0, period);
  const colOff = randInt(rng, 0, 5);

  for (let j = 0; j < N; j++) {
    const phase = ((j - bandOff) % period + period) % period;
    // phase 0,1 = bays backing onto the previous aisle; 2,3 = bays facing it
    const bayHead = phase === 0 || phase === 2;
    if (!bayHead) continue;
    // a bay is one cell wide and two deep, so the body lies along z; the two
    // rows in a band face opposite ways, nose out towards their own aisle
    const facing = phase === 0 ? Math.PI : 0;
    for (let i = 0; i < N; i++) {
      // columns interrupt the row on a regular grid, as they do in a real slab
      if ((i - colOff + 64) % 5 === 0) {
        c.solid[idx(i, j)] = 1;
        continue;
      }
      const x = cx * CHUNK + (i + 0.5) * CELL;
      const z = cz * CHUNK + (j + 1) * CELL;
      c.bays.push({ x, z, angle: 0 });
      if (rng() < 0.36) continue;          // an empty bay is a way through
      if (j + 1 >= N) continue;
      c.solid[idx(i, j)] = SOLID_PROP;
      c.solid[idx(i, j + 1)] = SOLID_PROP;
      c.cars.push({
        id: `${cx},${cz},${i},${j}`,
        x, y: 0, z,
        angle: facing,
        paint: CAR_PAINT[randInt(rng, 0, CAR_PAINT.length)],
        inverted: false,
      });
    }
  }
  // a couple of service walls, so the slab isn't perfectly readable
  wallRuns(rng, c.wallsV, c.wallsH, randInt(rng, 0, 3), 0.35);
}

// ----------------------------------------------------------- Level ! lobby

/**
 * The last floor. It is the lobby, built by something that only ever saw the
 * lobby from a distance: the same wallpaper, the wrong ceiling height, and
 * pieces of every floor you came through lying around in it — a car on the
 * ceiling, a pipe run through a bedroom wall, standing water in the carpet.
 */
function derangedLobby(rng: Rng, c: ChunkData, cx: number, cz: number): void {
  bspRooms(rng, c, 0, 0, N, N, 0);
  wallRuns(rng, c.wallsV, c.wallsH, randInt(rng, 2, 6), 0.5);
  for (let p = randInt(rng, 0, 4); p > 0; p--) {
    c.solid[idx(randInt(rng, 2, N - 2), randInt(rng, 2, N - 2))] = 1;
  }

  // standing water where the carpet has given up
  const pools = randInt(rng, 1, 5);
  for (let p = 0; p < pools; p++) {
    const i0 = randInt(rng, 1, N - 3);
    const j0 = randInt(rng, 1, N - 3);
    const w = randInt(rng, 1, 4);
    const h = randInt(rng, 1, 4);
    for (let j = j0; j < Math.min(j0 + h, N); j++) {
      for (let i = i0; i < Math.min(i0 + w, N); i++) c.water[idx(i, j)] = 1;
    }
  }

  // the floor is not quite level anywhere, and you feel it before you see it
  for (let k = 0; k < N * N; k++) {
    if (!c.solid[k] && rng() < 0.12) c.floor[k] = (rng() - 0.5) * 0.22;
  }

  // a car, indoors, and not always the right way up
  if (rng() < 0.3) {
    for (let tries = 0; tries < 16; tries++) {
      const i = randInt(rng, 1, N - 1);
      const j = randInt(rng, 1, N - 2);
      if (c.solid[idx(i, j)] || c.solid[idx(i, j + 1)]) continue;
      const inverted = rng() < 0.55;
      if (!inverted) {
        c.solid[idx(i, j)] = SOLID_PROP;
        c.solid[idx(i, j + 1)] = SOLID_PROP;
      }
      c.cars.push({
        id: `${cx},${cz},${i},${j}`,
        x: cx * CHUNK + (i + 0.5) * CELL,
        y: inverted ? c.ceil : 0,
        z: cz * CHUNK + (j + 1) * CELL,
        angle: rng() * Math.PI * 2,
        paint: CAR_PAINT[randInt(rng, 0, CAR_PAINT.length)],
        inverted,
      });
      break;
    }
  }
}

// ---------------------------------------------------------- descent sites

/**
 * Carve the room the way down lives in and record where its prop goes. Each
 * kind wants a different shape of hole: something to hang on, something to
 * walk down, or something to sink into.
 */
function buildDescentSite(
  c: ChunkData,
  si: number,
  sj: number,
  cellCenter: (i: number, j: number) => [number, number],
): void {
  const wx0 = c.cx * CHUNK;
  const wz0 = c.cz * CHUNK;
  const [sxw, szw] = cellCenter(si, sj);

  switch (c.biome) {
    case BiomeId.Level0: {
      // a clearing with one free-standing wall in it, and that wall is soft
      carveApron(c, si, sj, 3);
      standingWall(c, 0, si - 1, sj - 2, sj + 2);
      c.descent = {
        kind: 'softwall',
        x: wx0 + (si - 1) * CELL + WALL_THICKNESS / 2 + 0.02,
        y: 0, z: szw,
        angle: Math.PI / 2,
        tx: wx0 + (si - 1) * CELL + 1.1, ty: 0, tz: szw,
      };
      break;
    }
    case BiomeId.Level1: {
      // The service ramp: a shutter in a wall, and behind it a road that keeps
      // going. The length is the whole point — a four-step stub ending in a
      // wall reads as a cupboard, so the ramp runs to the far side of the
      // chunk and takes its ceiling down with it. Through the mouth you see
      // the lights march away and sink, and there is no question where it goes.
      carveApron(c, si, sj, 3);
      standingWall(c, 1, sj, si - 3, si + 3);
      for (let d = 0; d < 2; d++) c.wallsH[sj * N + si - 1 + d] = 0; // the mouth
      // Two lanes wide, walled down both sides, and sealed at the bottom: a
      // three-metre trench you could walk into from the level side is a hole a
      // player cannot climb back out of, and the shutter would be guarding
      // nothing. One cell of margin at the chunk border keeps the seal and its
      // soffit inside this chunk, where they have geometry to close them off.
      const bays = Math.max(4, sj - 1);
      for (let s = 1; s <= bays; s++) {
        const j = sj - s;
        if (j < 1) break;
        for (let d = -1; d <= 0; d++) {
          const k = idx(si + d, j);
          c.solid[k] = 0;
          c.floor[k] = -RAMP_FALL * s;
          // the soffit trails the road by one bay, so headroom never changes
          c.ceilDrop[k] = RAMP_FALL * (s - 1);
          c.water[k] = 0;
          c.wallsH[j * N + si + d] = s === bays ? 1 : 0;
        }
        c.wallsV[(si - 1) * N + j] = 1;
        c.wallsV[(si + 1) * N + j] = 1;
        // A strip every third bay. They get worse the further down they are,
        // which is what makes the bottom read as distance rather than as a wall.
        if (s % 3 === 1) {
          c.lights.push({
            x: wx0 + (si - 0.5) * CELL,
            y: c.ceil - RAMP_FALL * (s - 1) - 0.1,
            z: wz0 + (j + 0.5) * CELL,
            broken: s > bays - 3,
            flicker: s > 4,
            phase: s * 1.7,
            speed: 6 + s,
            strip: true,
          });
        }
      }
      c.descent = {
        kind: 'shutter',
        x: wx0 + (si - 0.5) * CELL, y: 0, z: wz0 + sj * CELL,
        angle: 0,
        // unchanged: the floor still takes you the same few metres in
        tx: wx0 + (si - 0.5) * CELL, ty: -RAMP_FALL * 4, tz: wz0 + (sj - 3.5) * CELL,
      };
      break;
    }
    case BiomeId.Level37: {
      // the deep end: a basin with no bottom you would want to stand on
      carveApron(c, si, sj, 3);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          c.floor[idx(si + di, sj + dj)] = -4.6;
        }
      }
      // The ring of cells around it steps down once, so the rim reads as a
      // lip. It has to stay inside one normal step of the floor outside it,
      // or climbing out of the pool needs a jump.
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          if (Math.abs(di) === 2 || Math.abs(dj) === 2) c.floor[idx(si + di, sj + dj)] = -0.4;
        }
      }
      for (let k = 0; k < N * N; k++) c.water[k] = 1;
      c.descent = {
        kind: 'drain',
        x: sxw, y: -4.6, z: szw,
        angle: 0,
        tx: sxw, ty: -4.0, tz: szw,
      };
      break;
    }
    case BiomeId.Level7: {
      // a flat pan on the bottom with a hatch bolted into the middle of it
      carveApron(c, si, sj, 3, -0.6);
      for (let k = 0; k < N * N; k++) c.water[k] = 1;
      c.descent = {
        kind: 'hatch',
        x: sxw, y: -0.6, z: szw,
        angle: 0,
        tx: sxw, ty: 0.1, tz: szw,
      };
      break;
    }
    case BiomeId.Level2: {
      // a fire door in a wall the tunnels were never supposed to reach
      carveApron(c, si, sj, 2);
      standingWall(c, 1, sj, si - 2, si + 2);
      c.wallsH[sj * N + si] = 0;
      // same stairwell, one cell wide, and sealed at the bottom for the same
      // reason: the only way in is through the door
      for (let s = 1; s <= 4; s++) {
        const j = sj - s;
        if (j < 0) break;
        const k = idx(si, j);
        c.solid[k] = 0;
        c.floor[k] = -0.4 * s;
        c.wallsH[j * N + si] = s === 4 ? 1 : 0;
        c.wallsV[si * N + j] = 1;
        c.wallsV[(si + 1) * N + j] = 1;
      }
      c.descent = {
        kind: 'door',
        x: sxw, y: 0, z: wz0 + sj * CELL,
        angle: 0,
        tx: sxw, ty: -1.6, tz: wz0 + (sj - 3.5) * CELL,
      };
      break;
    }
    case BiomeId.LevelRun:
      break; // the last floor has a portal, not a staircase
  }
}
