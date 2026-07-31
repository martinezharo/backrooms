// Deterministic per-chunk layout generation.
//
// A chunk is CELLS x CELLS cells. Walls live on cell edges:
//   wallsV[lineX * CELLS + j] — wall on the vertical line x=lineX, segment j (17 lines)
//   wallsH[lineZ * CELLS + i] — wall on the horizontal line z=lineZ, segment i
// Border lines (0 and 16) are derived from an "edge contract" hashed from world
// coordinates, so both neighbouring chunks compute identical border walls/doors.

import * as THREE from 'three';
import { CELLS, CELL, CHUNK } from '../core/constants';
import { chunkRng, hash3, mulberry32, randInt, Rng } from '../core/rng';
import { BiomeId, BIOMES, biomeForChunk } from './Biomes';
import { fuseSiteAt, isExitChunk, objectiveLayout } from './Objective';

export interface LightFixture {
  x: number; y: number; z: number; // world position of the panel
  broken: boolean;
  flicker: boolean;
  phase: number;
  speed: number;
}

export interface TapSpot { x: number; y: number; z: number; angle: number; }
export interface TableSpot { x: number; z: number; }
export interface ItemSpawn { id: string; itemId: string; x: number; y: number; z: number; }
/** Plinth holding one of the three fuses. */
export interface PedestalSpot { x: number; y: number; z: number; }
/** Almond water machine — crouch-free instant drink, a few servings only. */
export interface VendingSpot { x: number; y: number; z: number; angle: number; id: string; }
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

export interface ChunkData {
  cx: number;
  cz: number;
  biome: BiomeId;
  ceil: number;
  waterY: number | null;
  wallsV: Uint8Array;
  wallsH: Uint8Array;
  solid: Uint8Array;       // solid (pillar) cells — unwalkable
  floor: Float32Array;     // per-cell floor height
  water: Uint8Array;       // per-cell water flag
  lights: LightFixture[];
  taps: TapSpot[];
  tables: TableSpot[];
  itemSpawns: ItemSpawn[];
  pedestal: PedestalSpot | null;
  portal: PortalSpot | null;
  vending: VendingSpot[];
  group: THREE.Group | null;          // built scene subtree (set by ChunkBuilder)
  flickerPanels: { mesh: THREE.Mesh; light: LightFixture }[];
}

const N = CELLS;
const idx = (i: number, j: number) => j * N + i;

function borderLine(
  seed: number,
  axis: 0 | 1, // 0 = V, 1 = H
  gLine: number,
  strip: number,
  biomeA: BiomeId,
  biomeB: BiomeId,
): Uint8Array {
  const rng = mulberry32(hash3(seed ^ (axis === 0 ? 0x51ed270b : 0x2c9277b5), gLine, strip, 7));
  const line = new Uint8Array(N).fill(1);
  let doors: number;
  let width: number;
  if (biomeA !== biomeB) {
    doors = 2; width = 1;
  } else {
    switch (biomeA) {
      case BiomeId.Level0: doors = 4; width = 2; break;
      case BiomeId.Level2: doors = 2; width = 1; break;
      case BiomeId.Level37: doors = 5; width = 3; break;
      case BiomeId.Level7: doors = 6; width = 3; break;
    }
  }
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

const ITEM_TABLE: { id: string; w: number }[] = [
  { id: 'knife', w: 0.14 },
  { id: 'pipe', w: 0.14 },
  { id: 'bottle', w: 0.14 },
  { id: 'wrench', w: 0.1 },
  { id: 'extinguisher', w: 0.07 },
  { id: 'flashlight', w: 0.08 },
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

export function generateChunk(seed: number, cx: number, cz: number): ChunkData {
  const biome = biomeForChunk(seed, cx, cz);
  const def = BIOMES[biome];
  const rng = chunkRng(seed, cx, cz);

  const c: ChunkData = {
    cx, cz, biome,
    ceil: def.ceiling,
    waterY: def.waterLevel,
    wallsV: new Uint8Array((N + 1) * N),
    wallsH: new Uint8Array((N + 1) * N),
    solid: new Uint8Array(N * N),
    floor: new Float32Array(N * N),
    water: new Uint8Array(N * N),
    lights: [],
    taps: [],
    tables: [],
    itemSpawns: [],
    pedestal: null,
    portal: null,
    vending: [],
    group: null,
    flickerPanels: [],
  };

  // ---- border walls from the shared edge contract ----
  const bW = biomeForChunk(seed, cx - 1, cz);
  const bE = biomeForChunk(seed, cx + 1, cz);
  const bN = biomeForChunk(seed, cx, cz - 1);
  const bS = biomeForChunk(seed, cx, cz + 1);
  const lineW = borderLine(seed, 0, cx * N, cz, bW, biome);
  const lineE = borderLine(seed, 0, (cx + 1) * N, cz, biome, bE);
  const lineN = borderLine(seed, 1, cz * N, cx, bN, biome);
  const lineS = borderLine(seed, 1, (cz + 1) * N, cx, biome, bS);
  for (let k = 0; k < N; k++) {
    c.wallsV[0 * N + k] = lineW[k];
    c.wallsV[N * N + k] = lineE[k];
    c.wallsH[0 * N + k] = lineN[k];
    c.wallsH[N * N + k] = lineS[k];
  }

  // ---- interior layout per biome ----
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
      // Open halls with colonnades and sunken pool basins.
      const off = randInt(rng, 1, 4);
      for (let j = off; j < N - 1; j += 5) {
        for (let i = off; i < N - 1; i += 5) {
          c.solid[idx(i, j)] = 1;
        }
      }
      wallRuns(rng, c.wallsV, c.wallsH, randInt(rng, 1, 3), 0.4);
      const basins = randInt(rng, 1, 3);
      for (let b = 0; b < basins; b++) {
        const w = randInt(rng, 4, 9);
        const h = randInt(rng, 4, 9);
        const i0 = randInt(rng, 2, Math.max(3, N - 2 - w));
        const j0 = randInt(rng, 2, Math.max(3, N - 2 - h));
        for (let j = j0; j < Math.min(j0 + h, N - 2); j++) {
          for (let i = i0; i < Math.min(i0 + w, N - 2); i++) {
            const k = idx(i, j);
            c.floor[k] = -1.7;
            c.water[k] = 1;
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
      // Flooded open dark rooms.
      c.water.fill(1);
      const pillars = randInt(rng, 4, 9);
      for (let p = 0; p < pillars; p++) {
        c.solid[idx(randInt(rng, 1, N - 1), randInt(rng, 1, N - 1))] = 1;
      }
      wallRuns(rng, c.wallsV, c.wallsH, randInt(rng, 2, 5), 0.45);
      break;
    }
  }

  // Spawn chunk: keep the centre clear.
  if (cx === 0 && cz === 0) {
    for (let j = 6; j <= 9; j++) {
      for (let i = 6; i <= 9; i++) {
        c.solid[idx(i, j)] = 0;
        if (i > 6) c.wallsV[i * N + j] = 0;
        if (j > 6) c.wallsH[j * N + i] = 0;
      }
    }
  }

  // ---- objective room (carved before connectivity so it never seals itself) ----
  const fuseSite = fuseSiteAt(seed, cx, cz);
  const exitHere = isExitChunk(seed, cx, cz);
  let siteCell: { i: number; j: number } | null = null;
  if (fuseSite || exitHere) {
    const si = randInt(rng, 5, 11);
    const sj = randInt(rng, 5, 11);
    siteCell = { i: si, j: sj };
    // a clear 5x5 apron of walkable floor, dry and flat
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        const k = idx(si + di, sj + dj);
        c.solid[k] = 0;
        c.floor[k] = 0;
        c.water[k] = 0;
      }
    }
    // knock every wall out of the apron — these rooms read as a clearing
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        const i = si + di;
        const j = sj + dj;
        c.wallsV[i * N + j] = 0;
        c.wallsV[(i + 1) * N + j] = 0;
        c.wallsH[j * N + i] = 0;
        c.wallsH[(j + 1) * N + i] = 0;
      }
    }
    if (exitHere && objectiveLayout(seed).exit.onWall) {
      // the portal needs something to hang on: a free-standing partition two
      // cells west of the centre. Open at both ends, so the connectivity pass
      // never needs to carve through it.
      for (let dj = -1; dj <= 1; dj++) c.wallsV[(si - 1) * N + sj + dj] = 1;
    }
  }

  // ---- connectivity ----
  const seeds: number[] = [];
  for (const j of doorCellsOfLine(lineW)) seeds.push(idx(0, j));
  for (const j of doorCellsOfLine(lineE)) seeds.push(idx(N - 1, j));
  for (const i of doorCellsOfLine(lineN)) seeds.push(idx(i, 0));
  for (const i of doorCellsOfLine(lineS)) seeds.push(idx(i, N - 1));
  for (const s of seeds) c.solid[s] = 0; // door mouths must stay open
  fixConnectivity(c, seeds);

  const wx0 = cx * CHUNK;
  const wz0 = cz * CHUNK;
  const cellCenter = (i: number, j: number): [number, number] =>
    [wx0 + (i + 0.5) * CELL, wz0 + (j + 0.5) * CELL];

  // ---- light fixtures ----
  let lightStep = 3, brokenP = 0.1, flickerP = 0.14;
  if (biome === BiomeId.Level2) { lightStep = 4; brokenP = 0.22; flickerP = 0.28; }
  if (biome === BiomeId.Level37) { lightStep = 5; brokenP = 0.12; flickerP = 0.18; }
  if (biome === BiomeId.Level7) { lightStep = 5; brokenP = 0.55; flickerP = 0.3; }
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
      });
    }
  }
  // Spawn chunk must have a working light above the player.
  if (cx === 0 && cz === 0) {
    c.lights.push({ x: wx0 + 16, z: wz0 + 16, y: c.ceil - 0.1, broken: false, flicker: false, phase: 0, speed: 8 });
  }

  // ---- taps (Levels 0 and 2 only) ----
  if (biome === BiomeId.Level0 || biome === BiomeId.Level2) {
    const tapCount = rng() < 0.55 ? randInt(rng, 1, 3) : 0;
    for (let t = 0; t < tapCount; t++) {
      // find a wall segment with an open cell in front of it
      for (let tries = 0; tries < 30; tries++) {
        const i = randInt(rng, 1, N - 1);
        const j = randInt(rng, 1, N - 1);
        const k = idx(i, j);
        if (c.solid[k] || c.water[k]) continue;
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

  // ---- almond water machines (Levels 0 and 2, rare) ----
  if ((biome === BiomeId.Level0 || biome === BiomeId.Level2) && rng() < 0.15) {
    for (let tries = 0; tries < 24; tries++) {
      const i = randInt(rng, 1, N - 1);
      const j = randInt(rng, 1, N - 1);
      const k = idx(i, j);
      if (c.solid[k] || c.water[k]) continue;
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

  // ---- objective props ----
  if (siteCell) {
    const { i: si, j: sj } = siteCell;
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

  // ---- tables (Level 0, rare) ----
  if (biome === BiomeId.Level0 && rng() < 0.22) {
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
  const spawnItem = (itemId: string, near?: { i: number; j: number }) => {
    for (let tries = 0; tries < 24; tries++) {
      const i = near ? Math.min(N - 1, Math.max(0, near.i + randInt(rng, -2, 3))) : randInt(rng, 0, N);
      const j = near ? Math.min(N - 1, Math.max(0, near.j + randInt(rng, -2, 3))) : randInt(rng, 0, N);
      const k = idx(i, j);
      if (c.solid[k] || c.water[k]) continue;
      const [x, z] = cellCenter(i, j);
      c.itemSpawns.push({
        id: `${cx},${cz},${c.itemSpawns.length}`,
        itemId,
        x: x + (rng() - 0.5) * 0.8,
        y: c.floor[k] + 0.16,
        z: z + (rng() - 0.5) * 0.8,
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

  if (cx === 0 && cz === 0) {
    // Guaranteed early-game kit near spawn.
    spawnItem('flashlight', { i: 8, j: 8 });
    spawnItem('knife', { i: 8, j: 8 });
    spawnItem('detector', { i: 8, j: 8 });
    spawnItem('battery', { i: 8, j: 8 });
  } else {
    if (rng() < 0.38) spawnItem(rollItem(rng));
    if (rng() < 0.1) spawnItem(rollItem(rng));
  }
  // table gets a bonus item on top
  if (c.tables.length && rng() < 0.6) {
    const t = c.tables[0];
    c.itemSpawns.push({
      id: `${cx},${cz},${c.itemSpawns.length}`,
      itemId: rollItem(rng),
      x: t.x, y: 0.86, z: t.z,
    });
  }

  return c;
}
