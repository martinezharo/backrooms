// Turns ChunkData into merged meshes — a handful of draw calls per chunk.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, CELLS, CHUNK, WALL_THICKNESS } from '../core/constants';
import { getWorldMaterials } from '../rendering/Textures';
import { getWaterMaterial } from '../rendering/Water';
import { BiomeId, BIOMES, biomeForChunk } from './Biomes';
import { ChunkData } from './Chunk';

const N = CELLS;

type GeoBuckets = Record<string, THREE.BufferGeometry[]>;

function pushBox(
  buckets: GeoBuckets, key: string,
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  rotY = 0,
) {
  const g = new THREE.BoxGeometry(w, h, d);
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
function pushFloorCell(buckets: GeoBuckets, key: string, i: number, j: number, wx0: number, wz0: number, y: number, up: boolean) {
  const g = new THREE.PlaneGeometry(CELL, CELL);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let k = 0; k < uv.count; k++) {
    uv.setXY(k, uv.getX(k) + i, uv.getY(k) + j);
  }
  g.translate(wx0 + (i + 0.5) * CELL, y, wz0 + (j + 0.5) * CELL);
  (buckets[key] ??= []).push(g);
}

interface BiomeMats { wall: string; floor: string; ceil: string; }

function biomeMats(b: BiomeId): BiomeMats {
  switch (b) {
    case BiomeId.Level0: return { wall: 'wall', floor: 'carpet', ceil: 'ceiling' };
    case BiomeId.Level2: return { wall: 'concrete', floor: 'concrete', ceil: 'concrete' };
    case BiomeId.Level37: return { wall: 'tileWall', floor: 'tileFloor', ceil: 'tileWall' };
    case BiomeId.Level7: return { wall: 'concrete', floor: 'tileFloor', ceil: 'concrete' };
  }
}

export function buildChunk(seed: number, c: ChunkData): THREE.Group {
  const mats = getWorldMaterials();
  const matByKey: Record<string, THREE.Material> = {
    wall: mats.wall, carpet: mats.carpet, ceiling: mats.ceiling,
    concrete: mats.concrete, tileWall: mats.tileWall, tileFloor: mats.tileFloor,
    metal: mats.metal, frame: mats.fixtureFrame,
    panelOn: mats.fixtureOn, panelOff: mats.fixtureOff,
  };
  const bm = biomeMats(c.biome);
  const buckets: GeoBuckets = {};
  const wx0 = c.cx * CHUNK;
  const wz0 = c.cz * CHUNK;
  const idx = (i: number, j: number) => j * N + i;

  // ---- floors & ceiling ----
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = idx(i, j);
      if (c.solid[k]) continue;
      const floorKey = c.water[k] && c.biome === BiomeId.Level37 ? 'tileFloor' : bm.floor;
      pushFloorCell(buckets, floorKey, i, j, wx0, wz0, c.floor[k], true);
      pushFloorCell(buckets, bm.ceil, i, j, wx0, wz0, c.ceil, false);
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
        if (dir === 0) pushBox(buckets, 'tileWall', 0.06, h, CELL, wx0 + i * CELL + 0.03, cy, wz0 + (j + 0.5) * CELL);
        if (dir === 1) pushBox(buckets, 'tileWall', 0.06, h, CELL, wx0 + (i + 1) * CELL - 0.03, cy, wz0 + (j + 0.5) * CELL);
        if (dir === 2) pushBox(buckets, 'tileWall', CELL, h, 0.06, wx0 + (i + 0.5) * CELL, cy, wz0 + j * CELL + 0.03);
        if (dir === 3) pushBox(buckets, 'tileWall', CELL, h, 0.06, wx0 + (i + 0.5) * CELL, cy, wz0 + (j + 1) * CELL - 0.03);
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
        pushBox(buckets, bm.wall, WALL_THICKNESS, top - fl, CELL + WALL_THICKNESS, x, fl + (top - fl) / 2, z);
      } else if (isBorder && Math.abs(c.ceil - ceilW) > 0.01) {
        // lintel sealing the gap between mismatched ceilings above a doorway
        const lo = Math.min(c.ceil, ceilW) - 0.45;
        pushBox(buckets, bm.wall, WALL_THICKNESS, top - lo, CELL + WALL_THICKNESS, x, lo + (top - lo) / 2, z);
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
        pushBox(buckets, bm.wall, CELL + WALL_THICKNESS, top - fl, WALL_THICKNESS, x, fl + (top - fl) / 2, z);
      } else if (isBorder && Math.abs(c.ceil - ceilN) > 0.01) {
        const lo = Math.min(c.ceil, ceilN) - 0.45;
        pushBox(buckets, bm.wall, CELL + WALL_THICKNESS, top - lo, WALL_THICKNESS, x, lo + (top - lo) / 2, z);
      }
    }
  }

  // ---- solid pillar cells ----
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (!c.solid[idx(i, j)]) continue;
      pushBox(buckets, bm.wall, CELL, c.ceil, CELL, wx0 + (i + 0.5) * CELL, c.ceil / 2, wz0 + (j + 0.5) * CELL);
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

  // ---- pipes along the ceiling (Level 2) ----
  if (c.biome === BiomeId.Level2) {
    const prand = (n: number) => (Math.abs(Math.sin((c.cx * 37.7 + c.cz * 91.3 + n) * 12.9)) * N) | 0;
    for (let p = 0; p < 3; p++) {
      const alongX = p % 2 === 0;
      const lane = prand(p) % N;
      const y = c.ceil - 0.22 - p * 0.14;
      if (alongX) pushCylinder(buckets, 'metal', 0.07, CHUNK, 'x', wx0 + CHUNK / 2, y, wz0 + lane * CELL + 0.45);
      else pushCylinder(buckets, 'metal', 0.07, CHUNK, 'z', wx0 + lane * CELL + 0.45, y, wz0 + CHUNK / 2);
    }
  }

  // ---- tables ----
  for (const t of c.tables) {
    pushBox(buckets, 'frame', 1.3, 0.06, 0.75, t.x, 0.78, t.z);
    for (const [dx, dz] of [[-0.55, -0.3], [0.55, -0.3], [-0.55, 0.3], [0.55, 0.3]] as const) {
      pushBox(buckets, 'frame', 0.07, 0.78, 0.07, t.x + dx, 0.39, t.z + dz);
    }
  }

  // ---- assemble ----
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
      const mesh = new THREE.Mesh(g, getWaterMaterial());
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
