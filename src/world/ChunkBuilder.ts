// Turns ChunkData into merged meshes — a handful of draw calls per chunk.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, CELLS, CHUNK, WALL_THICKNESS } from '../core/constants';
import {
  getGraffitiMaterials, getWorldMaterials, ROT_WALL_COLS, ROT_WALL_ROWS, ROT_WALL_SHEETS,
} from '../rendering/Textures';
import { getWaterMaterial } from '../rendering/Water';
import { BiomeId } from './Biomes';
import { CarSpot, ChunkData, HOLE_CEIL, HOLE_FLOOR } from './Chunk';

const N = CELLS;

type GeoBuckets = Record<string, THREE.BufferGeometry[]>;

interface QuadBatch {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

/** Backlit product window of an almond water machine — a glow, not a lamp. */
let vendGlassMat: THREE.MeshStandardMaterial | null = null;
function vendGlass(): THREE.MeshStandardMaterial {
  vendGlassMat ??= new THREE.MeshStandardMaterial({
    color: 0x6d7248,
    emissive: 0xcfd79a,
    emissiveIntensity: 0.55,
    roughness: 0.35,
  });
  return vendGlassMat;
}

/** Bay markings, tyres and the glass nobody has cleaned in a long time. */
const propMats: Record<string, THREE.MeshStandardMaterial> = {};
function propMat(key: string, make: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  return propMats[key] ??= make();
}

/**
 * One material per paint colour, shared across every chunk — a car park is
 * hundreds of cars and nine colours.
 */
function carPaint(hex: number): THREE.MeshStandardMaterial {
  return propMat(`paint${hex}`, () => new THREE.MeshStandardMaterial({
    color: hex, roughness: 0.55, metalness: 0.35,
  }));
}

/**
 * Re-map a box's UVs from per-face 0..1 to world space, so one texture repeat
 * covers `metres` in every direction. Without it a tile texture is stretched
 * to whatever the wall happens to measure and the squares come out oblong.
 * BoxGeometry lays its faces out +x, -x, +y, -y, +z, -z, four vertices each.
 */
function worldUvs(g: THREE.BufferGeometry, w: number, h: number, d: number, metres: number): void {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const spans: [number, number][] = [
    [d, h], [d, h], // ±x faces: u runs along z, v along y
    [w, d], [w, d], // ±y faces: u along x, v along z
    [w, h], [w, h], // ±z faces: u along x, v along y
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = spans[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * (su / metres), uv.getY(i) * (sv / metres));
    }
  }
  uv.needsUpdate = true;
}

/** One sheet of an atlased texture, optionally hung the other way round. */
interface Sheet { cell: number; mirror: boolean; }

/**
 * Squeeze per-face 0..1 UVs into one cell of a texture atlas. The inset keeps
 * the filter from reaching into the neighbouring sheet at grazing angles, which
 * would show up as somebody else's tear bleeding round a corner.
 */
function atlasUvs(g: THREE.BufferGeometry, sheet: Sheet, cols: number, rows: number): void {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const col = sheet.cell % cols;
  const row = Math.floor(sheet.cell / cols);
  const inset = 0.004;
  for (let i = 0; i < uv.count; i++) {
    const u = sheet.mirror ? 1 - uv.getX(i) : uv.getX(i);
    const v = uv.getY(i);
    uv.setXY(
      i,
      (col + inset + u * (1 - inset * 2)) / cols,
      (row + inset + v * (1 - inset * 2)) / rows,
    );
  }
  uv.needsUpdate = true;
}

function pushBox(
  buckets: GeoBuckets, key: string,
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  rotY = 0,
  /** metres covered by one texture repeat; omit to stretch the map per face */
  uvMetres = 0,
  /** which sheet of the material's atlas this box reads from, if it has one */
  sheet?: Sheet,
) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (uvMetres) worldUvs(g, w, h, d, uvMetres);
  if (sheet) atlasUvs(g, sheet, ROT_WALL_COLS, ROT_WALL_ROWS);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  (buckets[key] ??= []).push(g);
}

function pushCylinder(
  buckets: GeoBuckets, key: string,
  r: number, len: number, axis: 'x' | 'y' | 'z',
  x: number, y: number, z: number,
) {
  const g = new THREE.CylinderGeometry(r, r, len, 10);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  (buckets[key] ??= []).push(g);
}

/** Floor quad for one cell with UVs offset so the texture tiles across the chunk. */
function pushFloorCell(
  batches: Record<string, QuadBatch>,
  key: string,
  i: number,
  j: number,
  wx0: number,
  wz0: number,
  y: number,
  up: boolean,
): void {
  const batch = batches[key] ??= { positions: [], normals: [], uvs: [], indices: [] };
  const base = batch.positions.length / 3;
  const x0 = wx0 + (i + 0.5) * CELL;
  const z0 = wz0 + (j + 0.5) * CELL;
  const half = CELL / 2;

  // Same vertex order and UV orientation as PlaneGeometry, but all 256 cell
  // quads for a material are written into one buffer instead of allocating a
  // temporary geometry for every floor and ceiling cell.
  for (let iy = 0; iy <= 1; iy++) {
    const localY = iy * CELL - half;
    for (let ix = 0; ix <= 1; ix++) {
      const localX = ix * CELL - half;
      batch.positions.push(x0 + localX, y, z0 + (up ? localY : -localY));
      batch.normals.push(0, up ? 1 : -1, 0);
      batch.uvs.push(ix + i, (1 - iy) + j);
    }
  }
  batch.indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
}

function makeQuadGeometry(batch: QuadBatch): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uvs, 2));
  geometry.setIndex(batch.indices);
  return geometry;
}

interface BiomeMats { wall: string; floor: string; ceil: string; }

function biomeMats(b: BiomeId): BiomeMats {
  switch (b) {
    case BiomeId.Level0: return { wall: 'wall', floor: 'carpet', ceil: 'ceiling' };
    case BiomeId.Level1: return { wall: 'painted', floor: 'asphalt', ceil: 'concrete' };
    case BiomeId.Level2: return { wall: 'concrete', floor: 'concrete', ceil: 'concrete' };
    case BiomeId.Level37: return { wall: 'tileWall', floor: 'tileFloor', ceil: 'tileWall' };
    case BiomeId.Level7: return { wall: 'concrete', floor: 'deepTile', ceil: 'concrete' };
    case BiomeId.LevelRun: return { wall: 'rotWall', floor: 'rotCarpet', ceil: 'ceiling' };
  }
}

/**
 * Which material a wall segment ends up in. The last floor got the lobby's
 * materials from memory and keeps losing its place: every so often a segment
 * comes out as concrete or bathroom tile instead of wallpaper, and nobody ever
 * fixed it. The rest draw one of the rotten wallpaper sheets — the texture is
 * stretched per face, so a single sheet would stamp the same tears onto every
 * panel in the corridor.
 */
function wallLook(c: ChunkData, lineKey: number, base: string): { key: string; sheet?: Sheet } {
  if (c.biome !== BiomeId.LevelRun) return { key: base };
  // deterministic per wall segment, so it doesn't shimmer between rebuilds
  const hash = (a: number, b: number, cc: number, d: number) => {
    const h = Math.sin(lineKey * a + c.cx * b + c.cz * cc) * d;
    return h - Math.floor(h);
  };
  const r = hash(12.9898, 7.13, 3.71, 43758.5453);
  if (r > 0.94) return { key: 'concrete' };
  if (r > 0.9) return { key: 'tileWall' };
  if (r > 0.87) return { key: 'wall' };   // a patch of the real thing, which is worse
  // a second, independent draw for which sheet of paper went up here and which
  // way round — one hash would tie the two together into a visible rhythm
  const s = hash(78.233, 3.17, 9.41, 24634.6345);
  const n = ROT_WALL_SHEETS;
  return { key: base, sheet: { cell: Math.floor(s * n) % n, mirror: (Math.floor(s * n * 2) & 1) === 1 } };
}

/**
 * One abandoned car, out of boxes and four cylinders. Nothing here is a model
 * file: the whole game is generated at runtime, and a downloaded hatchback with
 * real topology would be the only object in the world with any, which reads
 * worse than a shape that agrees with everything around it. Colour is the only
 * thing that varies, and that's enough — a hundred identical silhouettes in
 * nine paints is exactly what a car park looks like.
 */
function buildCar(buckets: GeoBuckets, matByKey: Record<string, THREE.Material>, car: CarSpot): void {
  const paintKey = `paint${car.paint}`;
  matByKey[paintKey] ??= carPaint(car.paint);
  const sin = Math.sin(car.angle);
  const cos = Math.cos(car.angle);
  const flip = car.inverted ? -1 : 1;
  const at = (lx: number, ly: number, lz: number): [number, number, number] => [
    car.x + lx * cos + lz * sin,
    car.y + ly * flip,
    car.z - lx * sin + lz * cos,
  ];
  const part = (key: string, w: number, h: number, d: number, lx: number, ly: number, lz: number) => {
    const [x, y, z] = at(lx, ly, lz);
    pushBox(buckets, key, w, h, d, x, y, z, car.angle);
  };

  part(paintKey, 1.78, 0.62, 4.3, 0, 0.74, 0);        // body
  part(paintKey, 1.66, 0.3, 3.9, 0, 0.42, 0);          // sills
  part(paintKey, 1.52, 0.14, 2.0, 0, 1.63, -0.05);     // roof
  part('glass', 1.64, 0.52, 2.24, 0, 1.32, -0.05);     // greenhouse
  part('tyre', 1.72, 0.14, 0.34, 0, 0.62, 2.16);       // bumpers
  part('tyre', 1.72, 0.14, 0.34, 0, 0.62, -2.16);
  part('lamp', 0.42, 0.16, 0.1, 0.6, 0.95, 2.18);      // headlamps
  part('lamp', 0.42, 0.16, 0.1, -0.6, 0.95, 2.18);
  part('lamp', 0.38, 0.14, 0.1, 0.62, 0.95, -2.18);    // tail lamps
  part('lamp', 0.38, 0.14, 0.1, -0.62, 0.95, -2.18);

  for (const lz of [1.42, -1.42]) {
    for (const lx of [0.86, -0.86]) {
      const g = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12);
      g.rotateZ(-Math.PI / 2);
      g.rotateY(car.angle);
      const [x, y, z] = at(lx, 0.34, lz);
      g.translate(x, y, z);
      (buckets.tyre ??= []).push(g);
    }
  }
}

export function buildChunk(c: ChunkData): THREE.Group {
  const mats = getWorldMaterials();
  const matByKey: Record<string, THREE.Material> = {
    wall: mats.wall, carpet: mats.carpet, ceiling: mats.ceiling,
    concrete: mats.concrete, tileWall: mats.tileWall, tileFloor: mats.tileFloor,
    deepTile: mats.deepTile, asphalt: mats.asphalt, painted: mats.painted,
    rotWall: mats.rotWall, rotCarpet: mats.rotCarpet,
    metal: mats.metal, frame: mats.fixtureFrame,
    panelOn: mats.fixtureOn, panelOff: mats.fixtureOff,
    vendGlass: vendGlass(),
    paint: propMat('linePaint', () => new THREE.MeshStandardMaterial({
      color: 0xd8d4c0, roughness: 0.9, metalness: 0,
    })),
    tyre: propMat('tyre', () => new THREE.MeshStandardMaterial({
      color: 0x14151a, roughness: 0.95, metalness: 0,
    })),
    glass: propMat('glass', () => new THREE.MeshStandardMaterial({
      color: 0x1b2226, roughness: 0.18, metalness: 0.6,
    })),
    lamp: propMat('lamp', () => new THREE.MeshStandardMaterial({
      color: 0x40200e, roughness: 0.4, metalness: 0.2,
    })),
  };
  getGraffitiMaterials().forEach((m, i) => { matByKey[`graffiti${i}`] = m; });
  const bm = biomeMats(c.biome);
  // Poolroom tile must read as the same square grid on every surface, so its
  // walls repeat once per cell exactly like the floor does. The other biomes
  // stretch their map per wall face, which is what their textures expect (the
  // Level 0 wallpaper carries its baseboard in the bottom of the canvas).
  const wallUv = c.biome === BiomeId.Level37 ? CELL : 0;
  const buckets: GeoBuckets = {};
  const floorBatches: Record<string, QuadBatch> = {};
  const wx0 = c.cx * CHUNK;
  const wz0 = c.cz * CHUNK;
  const idx = (i: number, j: number) => j * N + i;

  // ---- floors & ceiling ----
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = idx(i, j);
      if (c.solid[k]) continue;
      // a cell a connection passes through is missing that surface entirely
      if (!(c.hole[k] & HOLE_FLOOR)) {
        pushFloorCell(floorBatches, bm.floor, i, j, wx0, wz0, c.floor[k], true);
      }
      if (!(c.hole[k] & HOLE_CEIL)) {
        pushFloorCell(floorBatches, bm.ceil, i, j, wx0, wz0, c.ceil - c.ceilDrop[k], false);
      }
    }
  }

  // ---- basin side faces (vertical steps between cells of differing floor) ----
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = idx(i, j);
      if (c.solid[k]) continue;
      const f = c.floor[k];
      const sides: [number, number, number][] = [
        [i - 1, j, 0], [i + 1, j, 1], [i, j - 1, 2], [i, j + 1, 3],
      ];
      for (const [ni, nj, dir] of sides) {
        if (ni < 0 || ni >= N || nj < 0 || nj >= N) continue;
        const nk = idx(ni, nj);
        const nf = c.solid[nk] ? c.base : c.floor[nk];
        if (nf <= f + 0.01) continue;
        const h = nf - f;
        const cy = f + h / 2;
        const sideKey = bm.wall;
        if (dir === 0) pushBox(buckets, sideKey, 0.06, h, CELL, wx0 + i * CELL + 0.03, cy, wz0 + (j + 0.5) * CELL, 0, CELL);
        if (dir === 1) pushBox(buckets, sideKey, 0.06, h, CELL, wx0 + (i + 1) * CELL - 0.03, cy, wz0 + (j + 0.5) * CELL, 0, CELL);
        if (dir === 2) pushBox(buckets, sideKey, CELL, h, 0.06, wx0 + (i + 0.5) * CELL, cy, wz0 + j * CELL + 0.03, 0, CELL);
        if (dir === 3) pushBox(buckets, sideKey, CELL, h, 0.06, wx0 + (i + 0.5) * CELL, cy, wz0 + (j + 1) * CELL - 0.03, 0, CELL);
      }
    }
  }

  // ---- soffits (the same step, upside down, where a ceiling drops) ----
  // Without these, a bay whose ceiling hangs lower than its neighbour's opens a
  // slot straight into the void above the slab.
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = idx(i, j);
      if (c.solid[k]) continue;
      const drop = c.ceilDrop[k];
      if (drop <= 0.01) continue;
      const y = c.ceil - drop;
      const sides: [number, number, number][] = [
        [i - 1, j, 0], [i + 1, j, 1], [i, j - 1, 2], [i, j + 1, 3],
      ];
      for (const [ni, nj, dir] of sides) {
        if (ni < 0 || ni >= N || nj < 0 || nj >= N) continue;
        const nk = idx(ni, nj);
        if (c.solid[nk]) continue; // a solid cell is a full column already
        const nd = c.ceilDrop[nk];
        if (nd >= drop - 0.01) continue;
        const h = drop - nd;
        const cy = y + h / 2;
        if (dir === 0) pushBox(buckets, bm.wall, 0.06, h, CELL, wx0 + i * CELL + 0.03, cy, wz0 + (j + 0.5) * CELL, 0, CELL);
        if (dir === 1) pushBox(buckets, bm.wall, 0.06, h, CELL, wx0 + (i + 1) * CELL - 0.03, cy, wz0 + (j + 0.5) * CELL, 0, CELL);
        if (dir === 2) pushBox(buckets, bm.wall, CELL, h, 0.06, wx0 + (i + 0.5) * CELL, cy, wz0 + j * CELL + 0.03, 0, CELL);
        if (dir === 3) pushBox(buckets, bm.wall, CELL, h, 0.06, wx0 + (i + 0.5) * CELL, cy, wz0 + (j + 1) * CELL - 0.03, 0, CELL);
      }
    }
  }

  // ---- walls ----
  // This chunk renders its W/N border lines (0) and interior lines 1..15;
  // line 16 belongs to the +x/+z neighbour (identical data via edge contract).
  // Every chunk on a floor shares one ceiling height, so borders never need a
  // lintel to cover a step in the roof any more.
  for (let lineX = 0; lineX < N; lineX++) {
    for (let j = 0; j < N; j++) {
      if (!c.wallsV[lineX * N + j]) continue;
      const isBorder = lineX === 0;
      const x = wx0 + lineX * CELL;
      const z = wz0 + (j + 0.5) * CELL;
      const fl = isBorder ? c.base : Math.min(
        c.solid[idx(lineX - 1, j)] ? c.base : c.floor[idx(lineX - 1, j)],
        c.solid[idx(lineX, j)] ? c.base : c.floor[idx(lineX, j)],
      );
      const look = wallLook(c, lineX * 37 + j, bm.wall);
      pushBox(buckets, look.key, WALL_THICKNESS, c.ceil - fl, CELL + WALL_THICKNESS, x, fl + (c.ceil - fl) / 2, z, 0, wallUv, look.sheet);
    }
  }
  for (let lineZ = 0; lineZ < N; lineZ++) {
    for (let i = 0; i < N; i++) {
      if (!c.wallsH[lineZ * N + i]) continue;
      const isBorder = lineZ === 0;
      const x = wx0 + (i + 0.5) * CELL;
      const z = wz0 + lineZ * CELL;
      const fl = isBorder ? c.base : Math.min(
        c.solid[idx(i, lineZ - 1)] ? c.base : c.floor[idx(i, lineZ - 1)],
        c.solid[idx(i, lineZ)] ? c.base : c.floor[idx(i, lineZ)],
      );
      const look = wallLook(c, 991 + lineZ * 37 + i, bm.wall);
      pushBox(buckets, look.key, CELL + WALL_THICKNESS, c.ceil - fl, WALL_THICKNESS, x, fl + (c.ceil - fl) / 2, z, 0, wallUv, look.sheet);
    }
  }

  // ---- solid pillar cells ----
  // SOLID_PROP cells are blocked because something is parked on them; the prop
  // is the geometry, so don't stack a column of wallpaper on top of it.
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (c.solid[idx(i, j)] !== 1) continue;
      const look = c.biome === BiomeId.Level1
        ? { key: 'concrete', sheet: undefined }
        : wallLook(c, 2731 + i * 37 + j, bm.wall);
      const h = c.ceil - c.base;
      pushBox(buckets, look.key, CELL, h, CELL, wx0 + (i + 0.5) * CELL, c.base + h / 2, wz0 + (j + 0.5) * CELL, 0, wallUv, look.sheet);
    }
  }

  // ---- light fixtures ----
  // Ceiling panels everywhere except the slab, which is lit by bare tubes in
  // wire cages hung off the soffit — longer, meaner, and further apart.
  for (const L of c.lights) {
    const w = L.strip ? 2.4 : 1.0;
    const d = L.strip ? 0.24 : 0.6;
    pushBox(buckets, 'frame', w, 0.07, d, L.x, L.y + 0.02, L.z);
    if (!L.flicker || L.broken) {
      const g = new THREE.PlaneGeometry(w * 0.88, d * 0.8);
      g.rotateX(Math.PI / 2);
      g.translate(L.x, L.y - 0.025, L.z);
      (buckets[L.broken ? 'panelOff' : 'panelOn'] ??= []).push(g);
    }
  }

  // ---- bay markings ----
  // Painted before the building above them was cancelled: two lines down the
  // sides and a stub across the head, whether or not anything is parked there.
  for (const b of c.bays) {
    for (const s of [-1, 1]) {
      pushBox(buckets, 'paint', 0.1, 0.012, 3.9, b.x + s * (CELL / 2), c.base + 0.008, b.z);
    }
    pushBox(buckets, 'paint', CELL - 0.2, 0.012, 0.1, b.x, c.base + 0.008, b.z - 1.95);
  }

  // ---- cars ----
  for (const car of c.cars) buildCar(buckets, matByKey, car);

  // ---- taps ----
  for (const t of c.taps) {
    const cosA = Math.cos(t.angle);
    const sinA = -Math.sin(t.angle);
    const out = (d: number): [number, number] => [t.x + cosA * d, t.z + sinA * d];
    const [px1, pz1] = out(0.13);
    pushCylinder(buckets, 'metal', 0.035, 0.3, cosA !== 0 ? 'x' : 'z', px1, t.y, pz1);
    const [px2, pz2] = out(0.27);
    pushCylinder(buckets, 'metal', 0.03, 0.16, 'y', px2, t.y - 0.07, pz2);
    const [px3, pz3] = out(0.18);
    pushCylinder(buckets, 'metal', 0.06, 0.025, 'y', px3, t.y + 0.06, pz3);
  }

  // ---- pipe runs (Level 2) ----
  // Pipes follow the tunnels instead of a random lane: a corridor is a row or
  // column that runs clear through the chunk, so the run never buries itself
  // in concrete and always arrives at the neighbouring chunk's corridor.
  if (c.biome === BiomeId.Level2 || c.biome === BiomeId.Level1) {
    const rowClear = (j: number) => {
      for (let i = 0; i < N; i++) if (c.solid[idx(i, j)]) return false;
      return true;
    };
    const colClear = (i: number) => {
      for (let j = 0; j < N; j++) if (c.solid[idx(i, j)]) return false;
      return true;
    };
    /** A bundle of pipes hung along one corridor, with brackets every 4 m. */
    const runPipes = (alongX: boolean, lane: number) => {
      const mid = (alongX ? wx0 : wz0) + CHUNK / 2;
      const cross = (alongX ? wz0 : wx0) + (lane + 0.5) * CELL;
      const axis = alongX ? 'x' : 'z';
      const at = (off: number, y: number, r: number) => {
        const x = alongX ? mid : cross + off;
        const z = alongX ? cross + off : mid;
        pushCylinder(buckets, 'metal', r, CHUNK, axis, x, y, z);
      };
      // tucked into the corner where wall meets ceiling, out of the sightline
      at(-0.8, c.ceil - 0.17, 0.075);
      at(-0.63, c.ceil - 0.19, 0.045);
      at(0.82, c.ceil - 0.2, 0.055);
      for (let s = 0; s < 8; s++) {
        const along = (alongX ? wx0 : wz0) + (s + 0.5) * (CHUNK / 8);
        const x = alongX ? along : cross - 0.72;
        const z = alongX ? cross - 0.72 : along;
        pushBox(buckets, 'frame', alongX ? 0.05 : 0.3, 0.07, alongX ? 0.3 : 0.05, x, c.ceil - 0.06, z);
      }
    };
    // Only every other clear lane gets a run: in the open rooms every lane is
    // clear, and piping all of them turns the ceiling into a grid.
    let lastRow = -9;
    for (let j = 0; j < N; j++) {
      if (!rowClear(j) || j - lastRow < 3) continue;
      runPipes(true, j);
      lastRow = j;
    }
    let lastCol = -9;
    for (let i = 0; i < N; i++) {
      if (!colClear(i) || i - lastCol < 3) continue;
      runPipes(false, i);
      lastCol = i;
    }
  }

  // ---- fuse plinth ----
  if (c.pedestal) {
    const p = c.pedestal;
    pushBox(buckets, 'metal', 0.5, 0.86, 0.5, p.x, p.y + 0.43, p.z);
    pushBox(buckets, 'frame', 0.72, 0.08, 0.72, p.x, p.y + 0.9, p.z);
    pushBox(buckets, 'metal', 0.62, 0.05, 0.62, p.x, p.y + 0.03, p.z);
  }

  // ---- almond water machines ----
  for (const v of c.vending) {
    const rot = v.angle;
    const fx = Math.sin(rot);   // local +z in world space
    const fz = Math.cos(rot);
    pushBox(buckets, 'metal', 1.0, 1.9, 0.62, v.x, v.y + 0.95, v.z, rot);
    // backlit product window, just proud of the front face, in a dark surround
    pushBox(buckets, 'frame', 0.84, 1.26, 0.03, v.x + fx * 0.31, v.y + 1.18, v.z + fz * 0.31, rot);
    pushBox(buckets, 'vendGlass', 0.68, 1.1, 0.04, v.x + fx * 0.33, v.y + 1.18, v.z + fz * 0.33, rot);
    // dispenser slot
    pushBox(buckets, 'frame', 0.5, 0.1, 0.16, v.x + fx * 0.3, v.y + 0.42, v.z + fz * 0.3, rot);
  }

  // ---- graffiti decals ----
  for (const g of c.graffiti) {
    const geo = new THREE.PlaneGeometry(g.size, g.size);
    geo.rotateY(g.angle);
    geo.translate(g.x, g.y, g.z);
    (buckets[`graffiti${g.variant}`] ??= []).push(geo);
  }

  // ---- tables ----
  for (const t of c.tables) {
    pushBox(buckets, 'frame', 1.3, 0.06, 0.75, t.x, c.base + 0.78, t.z);
    for (const [dx, dz] of [[-0.55, -0.3], [0.55, -0.3], [-0.55, 0.3], [0.55, 0.3]] as const) {
      pushBox(buckets, 'frame', 0.07, 0.78, 0.07, t.x + dx, c.base + 0.39, t.z + dz);
    }
  }

  // ---- assemble ----
  for (const [key, batch] of Object.entries(floorBatches)) {
    (buckets[key] ??= []).push(makeQuadGeometry(batch));
  }
  const group = new THREE.Group();
  group.name = `chunk_${c.cx}_${c.cz}`;
  for (const [key, geos] of Object.entries(buckets)) {
    if (!geos.length) continue;
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    for (const g of geos) g.dispose();
    const mesh = new THREE.Mesh(merged, matByKey[key]);
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    if (key === bm.wall || key === 'wall' || key === 'concrete' || key === 'tileWall') {
      mesh.castShadow = true;
    }
    group.add(mesh);
  }

  // flickering panels get their own mesh + cloned material for per-frame dimming
  for (const L of c.lights) {
    if (L.broken || !L.flicker) continue;
    const g = new THREE.PlaneGeometry(0.88, 0.48);
    g.rotateX(Math.PI / 2);
    const mat = (getWorldMaterials().fixtureOn).clone();
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(L.x, L.y - 0.025, L.z);
    group.add(mesh);
    c.flickerPanels.push({ mesh, light: L });
  }

  // ---- water surface ----
  // One quad per wet cell rather than one over the bounding box: a level with
  // scattered puddles would otherwise get a single sheet of water stretched
  // between them, across dry carpet. The surface is a flat plane, so all the
  // quads are built at y = 0 and the mesh is placed at the level's water line —
  // which is how the whole floor can flood by moving one object.
  if (c.waterY !== null) {
    const surface: Record<string, QuadBatch> = {};
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = idx(i, j);
        if (!c.water[k] || c.solid[k]) continue;
        pushFloorCell(surface, 'w', i, j, wx0, wz0, 0, true);
      }
    }
    if (surface.w) {
      const kind = c.biome === BiomeId.Level37 ? 'pool'
        : c.biome === BiomeId.Level7 ? 'deep' : 'film';
      const mesh = new THREE.Mesh(makeQuadGeometry(surface.w), getWaterMaterial(kind));
      mesh.position.y = c.waterY;
      mesh.renderOrder = 2;
      group.add(mesh);
      c.waterMesh = mesh;
    }
  }

  return group;
}

/** Dispose geometries; shared materials stay alive, flicker clones are disposed via ChunkData. */
export function disposeChunk(c: ChunkData): void {
  c.group?.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.geometry.dispose();
  });
  for (const fp of c.flickerPanels) {
    (fp.mesh.material as THREE.Material).dispose();
  }
  c.flickerPanels.length = 0;
  c.waterMesh = null;
}
