// Chunk streaming + all spatial queries (collision, walls, water, biome).

import * as THREE from 'three';
import { CELL, CELLS, CHUNK, LOAD_RADIUS, UNLOAD_RADIUS } from '../core/constants';
import { BiomeDef, BiomeId, BIOMES, biomeForChunk } from './Biomes';
import { ChunkData, generateChunk, LightFixture } from './Chunk';
import { buildChunk, disposeChunk } from './ChunkBuilder';

const N = CELLS;

export interface AABB { minX: number; maxX: number; minZ: number; maxZ: number; }

/** Deterministic flicker pattern shared by panels and the light pool. */
export function flickerOn(light: LightFixture, time: number): boolean {
  if (light.broken) return false;
  if (!light.flicker) return true;
  const t = time * light.speed + light.phase;
  return Math.sin(t) + Math.sin(t * 1.73) * 0.7 + Math.sin(t * 0.31) * 0.5 > -0.2;
}

export class World {
  readonly seed: number;
  private scene: THREE.Scene;
  private chunks = new Map<string, ChunkData>();

  onChunkLoaded: ((c: ChunkData) => void) | null = null;
  onChunkUnloaded: ((c: ChunkData) => void) | null = null;

  constructor(seed: number, scene: THREE.Scene) {
    this.seed = seed;
    this.scene = scene;
  }

  private key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  getChunk(cx: number, cz: number): ChunkData | null {
    return this.chunks.get(this.key(cx, cz)) ?? null;
  }

  allChunks(): IterableIterator<ChunkData> {
    return this.chunks.values();
  }

  /** Stream chunks around the player. Generates at most one chunk per call to avoid hitches. */
  update(px: number, pz: number): void {
    const pcx = Math.floor(px / CHUNK);
    const pcz = Math.floor(pz / CHUNK);

    // unload far chunks
    for (const [k, c] of this.chunks) {
      if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > UNLOAD_RADIUS) {
        if (c.group) this.scene.remove(c.group);
        disposeChunk(c);
        this.onChunkUnloaded?.(c);
        this.chunks.delete(k);
      }
    }

    // load near chunks, closest first, one per frame
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
      for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        if (this.chunks.has(this.key(cx, cz))) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = [cx, cz]; }
      }
    }
    if (best) this.loadChunk(best[0], best[1]);
  }

  /** Force-generate everything around a point (used once at spawn). */
  preload(px: number, pz: number, radius = LOAD_RADIUS): void {
    const pcx = Math.floor(px / CHUNK);
    const pcz = Math.floor(pz / CHUNK);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (!this.chunks.has(this.key(pcx + dx, pcz + dz))) {
          this.loadChunk(pcx + dx, pcz + dz);
        }
      }
    }
  }

  private loadChunk(cx: number, cz: number): void {
    const c = generateChunk(this.seed, cx, cz);
    c.group = buildChunk(this.seed, c);
    this.scene.add(c.group);
    this.chunks.set(this.key(cx, cz), c);
    this.onChunkLoaded?.(c);
  }

  dispose(): void {
    for (const c of this.chunks.values()) {
      if (c.group) this.scene.remove(c.group);
      disposeChunk(c);
    }
    this.chunks.clear();
  }

  // ------------------------------------------------------------------
  // queries — global cell coordinates: gi = floor(x / CELL)
  // ------------------------------------------------------------------

  biomeAt(x: number, z: number): BiomeDef {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const c = this.getChunk(cx, cz);
    return BIOMES[c ? c.biome : biomeForChunk(this.seed, cx, cz)];
  }

  private cell(gi: number, gj: number): { c: ChunkData; i: number; j: number } | null {
    const cx = Math.floor(gi / N);
    const cz = Math.floor(gj / N);
    const c = this.getChunk(cx, cz);
    if (!c) return null;
    return { c, i: gi - cx * N, j: gj - cz * N };
  }

  isSolidCell(gi: number, gj: number): boolean {
    const r = this.cell(gi, gj);
    if (!r) return true; // unloaded = solid
    return !!r.c.solid[r.j * N + r.i];
  }

  floorAt(gi: number, gj: number): number {
    const r = this.cell(gi, gj);
    if (!r || r.c.solid[r.j * N + r.i]) return Infinity;
    return r.c.floor[r.j * N + r.i];
  }

  ceilAt(gi: number, gj: number): number {
    const r = this.cell(gi, gj);
    return r ? r.c.ceil : Infinity;
  }

  /** Water surface height in this cell, or null. */
  waterSurfaceAt(x: number, z: number): number | null {
    const gi = Math.floor(x / CELL);
    const gj = Math.floor(z / CELL);
    const r = this.cell(gi, gj);
    if (!r || r.c.waterY === null) return null;
    return r.c.water[r.j * N + r.i] ? r.c.waterY : null;
  }

  /** Wall on the vertical grid line gx, segment gj. */
  hasWallV(gx: number, gj: number): boolean {
    const cz = Math.floor(gj / N);
    const j = gj - cz * N;
    // owning chunk has lineX = gx - cx*N in [0..16]
    let cx = Math.floor(gx / N);
    let lineX = gx - cx * N;
    let c = this.getChunk(cx, cz);
    if (!c && lineX === 0) { // border line is duplicated in the -x neighbour as line N
      cx -= 1; lineX = N;
      c = this.getChunk(cx, cz);
    }
    if (!c) return true;
    return !!c.wallsV[lineX * N + j];
  }

  hasWallH(gi: number, gz: number): boolean {
    const cx = Math.floor(gi / N);
    const i = gi - cx * N;
    let cz = Math.floor(gz / N);
    let lineZ = gz - cz * N;
    let c = this.getChunk(cx, cz);
    if (!c && lineZ === 0) {
      cz -= 1; lineZ = N;
      c = this.getChunk(cx, cz);
    }
    if (!c) return true;
    return !!c.wallsH[lineZ * N + i];
  }

  /** Can an agent step from cell A to a 4-neighbour cell B? (for A* and AI) */
  passable(gi: number, gj: number, di: number, dj: number, maxStep = 0.5): boolean {
    const ti = gi + di;
    const tj = gj + dj;
    if (this.isSolidCell(ti, tj)) return false;
    const fa = this.floorAt(gi, gj);
    const fb = this.floorAt(ti, tj);
    if (!isFinite(fa) || !isFinite(fb) || Math.abs(fa - fb) > maxStep) return false;
    if (di === 1) return !this.hasWallV(ti, gj);
    if (di === -1) return !this.hasWallV(gi, gj);
    if (dj === 1) return !this.hasWallH(gi, tj);
    return !this.hasWallH(gi, gj);
  }

  // ------------------------------------------------------------------
  // collision
  // ------------------------------------------------------------------

  /**
   * Solid XZ boxes near a position: blocked cells (solid / too-high step /
   * unloaded) as full boxes, plus thin wall boxes on cell edges.
   */
  collectSolids(x: number, z: number, feetY: number, maxStep: number, out: AABB[]): void {
    out.length = 0;
    const gi = Math.floor(x / CELL);
    const gj = Math.floor(z / CELL);
    const T = 0.13; // half wall thickness used for collision
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ci = gi + di;
        const cj = gj + dj;
        const f = this.floorAt(ci, cj);
        if (!isFinite(f) || f > feetY + maxStep) {
          out.push({ minX: ci * CELL, maxX: (ci + 1) * CELL, minZ: cj * CELL, maxZ: (cj + 1) * CELL });
          continue;
        }
        // walls on this cell's west and north edges
        if (this.hasWallV(ci, cj)) {
          out.push({ minX: ci * CELL - T, maxX: ci * CELL + T, minZ: cj * CELL, maxZ: (cj + 1) * CELL });
        }
        if (this.hasWallH(ci, cj)) {
          out.push({ minX: ci * CELL, maxX: (ci + 1) * CELL, minZ: cj * CELL - T, maxZ: cj * CELL + T });
        }
        // east/south edges of the outer ring
        if (di === 1 && this.hasWallV(ci + 1, cj)) {
          out.push({ minX: (ci + 1) * CELL - T, maxX: (ci + 1) * CELL + T, minZ: cj * CELL, maxZ: (cj + 1) * CELL });
        }
        if (dj === 1 && this.hasWallH(ci, cj + 1)) {
          out.push({ minX: ci * CELL, maxX: (ci + 1) * CELL, minZ: (cj + 1) * CELL - T, maxZ: (cj + 1) * CELL + T });
        }
      }
    }
  }

  /** Push a circle (x,z,r) out of the given AABBs. Returns the resolved position. */
  static resolveCircle(x: number, z: number, r: number, solids: AABB[]): [number, number] {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of solids) {
        const cx = Math.max(b.minX, Math.min(x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
        let dx = x - cx;
        let dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          x = cx + (dx / d) * r;
          z = cz + (dz / d) * r;
        } else {
          // centre inside the box — push out along the shallowest axis
          const pxl = x - b.minX, pxr = b.maxX - x;
          const pzl = z - b.minZ, pzr = b.maxZ - z;
          const m = Math.min(pxl, pxr, pzl, pzr);
          if (m === pxl) x = b.minX - r;
          else if (m === pxr) x = b.maxX + r;
          else if (m === pzl) z = b.minZ - r;
          else z = b.maxZ + r;
        }
        moved = true;
      }
      if (!moved) break;
    }
    return [x, z];
  }

  /** Highest reachable floor under a circle footprint. */
  groundHeight(x: number, z: number, r: number, feetY: number, maxStep: number): number {
    let g = -Infinity;
    const cells: [number, number][] = [
      [Math.floor((x - r) / CELL), Math.floor((z - r) / CELL)],
      [Math.floor((x + r) / CELL), Math.floor((z - r) / CELL)],
      [Math.floor((x - r) / CELL), Math.floor((z + r) / CELL)],
      [Math.floor((x + r) / CELL), Math.floor((z + r) / CELL)],
    ];
    for (const [gi, gj] of cells) {
      const f = this.floorAt(gi, gj);
      if (isFinite(f) && f <= feetY + maxStep) g = Math.max(g, f);
    }
    if (g === -Infinity) {
      const f = this.floorAt(Math.floor(x / CELL), Math.floor(z / CELL));
      g = isFinite(f) ? f : 0;
    }
    return g;
  }

  ceilHeight(x: number, z: number): number {
    return this.ceilAt(Math.floor(x / CELL), Math.floor(z / CELL));
  }

  /**
   * Is the straight XZ segment blocked by a wall or solid cell?
   * Walks cell boundaries with a DDA and checks edge walls at each crossing.
   */
  lineBlocked(ax: number, az: number, bx: number, bz: number): boolean {
    let gi = Math.floor(ax / CELL);
    let gj = Math.floor(az / CELL);
    const ti = Math.floor(bx / CELL);
    const tj = Math.floor(bz / CELL);
    if (this.isSolidCell(gi, gj)) return true;
    const dx = bx - ax;
    const dz = bz - az;
    const stepI = dx > 0 ? 1 : -1;
    const stepJ = dz > 0 ? 1 : -1;
    let tMaxX = dx !== 0 ? (((dx > 0 ? gi + 1 : gi) * CELL) - ax) / dx : Infinity;
    let tMaxZ = dz !== 0 ? (((dz > 0 ? gj + 1 : gj) * CELL) - az) / dz : Infinity;
    const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    for (let guard = 0; guard < 80; guard++) {
      if (gi === ti && gj === tj) return false;
      if (tMaxX < tMaxZ) {
        if (this.hasWallV(dx > 0 ? gi + 1 : gi, gj)) return true;
        gi += stepI;
        tMaxX += tDeltaX;
      } else {
        if (this.hasWallH(gi, dz > 0 ? gj + 1 : gj)) return true;
        gj += stepJ;
        tMaxZ += tDeltaZ;
      }
      if (this.isSolidCell(gi, gj)) return true;
    }
    return true;
  }

  /** Random walkable cell centre within ring [minDist, maxDist] of a point. */
  findSpawnSpot(
    x: number, z: number, minDist: number, maxDist: number,
    rnd: () => number,
    filter?: (c: ChunkData, biome: BiomeId) => boolean,
  ): THREE.Vector3 | null {
    for (let tries = 0; tries < 40; tries++) {
      const ang = rnd() * Math.PI * 2;
      const dist = minDist + rnd() * (maxDist - minDist);
      const sx = x + Math.cos(ang) * dist;
      const sz = z + Math.sin(ang) * dist;
      const gi = Math.floor(sx / CELL);
      const gj = Math.floor(sz / CELL);
      const r = this.cell(gi, gj);
      if (!r) continue;
      if (r.c.solid[r.j * N + r.i]) continue;
      if (r.c.water[r.j * N + r.i]) continue;
      if (filter && !filter(r.c, r.c.biome)) continue;
      const f = r.c.floor[r.j * N + r.i];
      return new THREE.Vector3((gi + 0.5) * CELL, f, (gj + 0.5) * CELL);
    }
    return null;
  }
}
