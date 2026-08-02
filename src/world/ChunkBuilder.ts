// Turns ChunkData into merged meshes — a handful of draw calls per chunk.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, CELLS, CHUNK, WALL_THICKNESS } from '../core/constants';
import { getGraffitiMaterials, getWorldMaterials } from '../rendering/Textures';
import { getWaterMaterial } from '../rendering/Water';
import { BiomeId, BIOMES, biomeForChunk } from './Biomes';
import { ChunkData } from './Chunk';

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

function pushBox(
  buckets: GeoBuckets, key: string,
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  rotY = 0,
  /** metres covered by one texture repeat; omit to stretch the map per face */
  uvMetres = 0,
) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (uvMetres) worldUvs(g, w, h, d, uvMetres);
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
    case BiomeId.Level2: return { wall: 'concrete', floor: 'concrete', ceil: 'concrete' };
    case BiomeId.Level37: return { wall: 'tileWall', floor: 'tileFloor', ceil: 'tileWall' };
    case BiomeId.Level7: return { wall: 'concrete', floor: 'deepTile', ceil: 'concrete' };
  }
}

export function buildChunk(seed: number, c: ChunkData): THREE.Group {
  const mats = getWorldMaterials();
  const matByKey: Record<string, THREE.Material> = {
    wall: mats.wall, carpet: mats.carpet, ceiling: mats.ceiling,
    concrete: mats.concrete, tileWall: mats.tileWall, tileFloor: mats.tileFloor,
    deepTile: mats.deepTile,
    metal: mats.metal, frame: mats.fixtureFrame,
    panelOn: mats.fixtureOn, panelOff: mats.fixtureOff,
    vendGlass: vendGlass(),
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
      const floorKey = c.water[k] && c.biome === BiomeId.Level37 ? 'tileFloor' : bm.floor;
      pushFloorCell(floorBatches, floorKey, i, j, wx0, wz0, c.floor[k], true);
      pushFloorCell(floorBatches, bm.ceil, i, j, wx0, wz0, c.ceil, false);
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
        const nf = c.solid[nk] ? 0 : c.floor[nk];
        if (nf <= f + 0.01) continue;
        const h = nf - f;
        const cy = f + h / 2;
        if (dir === 0) pushBox(buckets, 'tileWall', 0.06, h, CELL, wx0 + i * CELL + 0.03, cy, wz0 + (j + 0.5) * CELL, 0, CELL);
        if (dir === 1) pushBox(buckets, 'tileWall', 0.06, h, CELL, wx0 + (i + 1) * CELL - 0.03, cy, wz0 + (j + 0.5) * CELL, 0, CELL);
        if (dir === 2) pushBox(buckets, 'tileWall', CELL, h, 0.06, wx0 + (i + 0.5) * CELL, cy, wz0 + j * CELL + 0.03, 0, CELL);
        if (dir === 3) pushBox(buckets, 'tileWall', CELL, h, 0.06, wx0 + (i + 0.5) * CELL, cy, wz0 + (j + 1) * CELL - 0.03, 0, CELL);
      }
    }
  }

  // ---- walls ----
  // This chunk renders its W/N border lines (0) and interior lines 1..15;
  // line 16 belongs to the +x/+z neighbour (identical data via edge contract).
  const ceilW = BIOMES[biomeForChunk(seed, c.cx - 1, c.cz)].ceiling;
  const ceilN = BIOMES[biomeForChunk(seed, c.cx, c.cz - 1)].ceiling;

  for (let lineX = 0; lineX < N + 1; lineX++) {
    if (lineX === N) continue;
    for (let j = 0; j < N; j++) {
      const isBorder = lineX === 0;
      const top = isBorder ? Math.max(c.ceil, ceilW) : c.ceil;
      const x = wx0 + lineX * CELL;
      const z = wz0 + (j + 0.5) * CELL;
      if (c.wallsV[lineX * N + j]) {
        const fl = isBorder ? 0 : Math.min(
          c.solid[idx(lineX - 1, j)] ? 0 : c.floor[idx(lineX - 1, j)],
          c.solid[idx(lineX, j)] ? 0 : c.floor[idx(lineX, j)],
        );
        pushBox(buckets, bm.wall, WALL_THICKNESS, top - fl, CELL + WALL_THICKNESS, x, fl + (top - fl) / 2, z, 0, wallUv);
      } else if (isBorder && Math.abs(c.ceil - ceilW) > 0.01) {
        // lintel sealing the gap between mismatched ceilings above a doorway
        const lo = Math.min(c.ceil, ceilW) - 0.45;
        pushBox(buckets, bm.wall, WALL_THICKNESS, top - lo, CELL + WALL_THICKNESS, x, lo + (top - lo) / 2, z, 0, wallUv);
      }
    }
  }
  for (let lineZ = 0; lineZ < N + 1; lineZ++) {
    if (lineZ === N) continue;
    for (let i = 0; i < N; i++) {
      const isBorder = lineZ === 0;
      const top = isBorder ? Math.max(c.ceil, ceilN) : c.ceil;
      const x = wx0 + (i + 0.5) * CELL;
      const z = wz0 + lineZ * CELL;
      if (c.wallsH[lineZ * N + i]) {
        const fl = isBorder ? 0 : Math.min(
          c.solid[idx(i, lineZ - 1)] ? 0 : c.floor[idx(i, lineZ - 1)],
          c.solid[idx(i, lineZ)] ? 0 : c.floor[idx(i, lineZ)],
        );
        pushBox(buckets, bm.wall, CELL + WALL_THICKNESS, top - fl, WALL_THICKNESS, x, fl + (top - fl) / 2, z, 0, wallUv);
      } else if (isBorder && Math.abs(c.ceil - ceilN) > 0.01) {
        const lo = Math.min(c.ceil, ceilN) - 0.45;
        pushBox(buckets, bm.wall, CELL + WALL_THICKNESS, top - lo, WALL_THICKNESS, x, lo + (top - lo) / 2, z, 0, wallUv);
      }
    }
  }

  // ---- solid pillar cells ----
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (!c.solid[idx(i, j)]) continue;
      pushBox(buckets, bm.wall, CELL, c.ceil, CELL, wx0 + (i + 0.5) * CELL, c.ceil / 2, wz0 + (j + 0.5) * CELL, 0, wallUv);
    }
  }

  // ---- light fixtures ----
  for (const L of c.lights) {
    pushBox(buckets, 'frame', 1.0, 0.07, 0.6, L.x, L.y + 0.02, L.z);
    if (!L.flicker || L.broken) {
      const g = new THREE.PlaneGeometry(0.88, 0.48);
      g.rotateX(Math.PI / 2);
      g.translate(L.x, L.y - 0.025, L.z);
      (buckets[L.broken ? 'panelOff' : 'panelOn'] ??= []).push(g);
    }
  }

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
  if (c.biome === BiomeId.Level2) {
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
    pushBox(buckets, 'frame', 1.3, 0.06, 0.75, t.x, 0.78, t.z);
    for (const [dx, dz] of [[-0.55, -0.3], [0.55, -0.3], [-0.55, 0.3], [0.55, 0.3]] as const) {
      pushBox(buckets, 'frame', 0.07, 0.78, 0.07, t.x + dx, 0.39, t.z + dz);
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
  if (c.waterY !== null) {
    let minI = N, maxI = -1, minJ = N, maxJ = -1;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if (c.water[idx(i, j)]) {
          minI = Math.min(minI, i); maxI = Math.max(maxI, i);
          minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j);
        }
      }
    }
    if (maxI >= 0) {
      const w = (maxI - minI + 1) * CELL;
      const d = (maxJ - minJ + 1) * CELL;
      const g = new THREE.PlaneGeometry(w, d, 12, 12);
      g.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(g, getWaterMaterial(c.biome === BiomeId.Level37 ? 'pool' : 'deep'));
      mesh.position.set(wx0 + minI * CELL + w / 2, c.waterY, wz0 + minJ * CELL + d / 2);
      mesh.renderOrder = 2;
      group.add(mesh);
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
}
