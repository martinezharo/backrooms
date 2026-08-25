// Chunk streaming + all spatial queries (collision, walls, water, biome).

import * as THREE from 'three';
import { CELL, CELLS, CHUNK, LOAD_RADIUS, UNLOAD_RADIUS } from '../core/constants';
import { BiomeDef, BiomeId, defForDepth } from './Biomes';
import { ChunkData, generateChunk, LightFixture } from './Chunk';
import { buildChunk, disposeChunk } from './ChunkBuilder';
import { bakeSlab, insidePipe, ShaftSpec, slabForY } from './Slabs';

const N = CELLS;

/**
 * Chunks of the far side of a connection to keep built, measured from the hole.
 * One ring is 96 m across; nothing is visible that far through the fog on
 * either of the floors a shaft joins.
 */
const NEIGHBOUR_RADIUS = 1;

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
  /** which floor of the building is currently built */
  depth = 0;
  /**
   * Metres the level's water has risen above where it was poured. Only Level 37
   * ever moves it, and when it does it moves everywhere at once.
   */
  waterRise = 0;
  /** the floor that rise belongs to — the one above is not filling up too */
  private floodDepth = -1;
  /**
   * Solids that are not part of any chunk: a shutter that has not rolled up
   * yet, a door still locked. Owned by whoever put them there.
   */
  readonly propBlockers: AABB[] = [];

  /**
   * The hole joining this floor to the one below, once a floor has one. While
   * it is shut it is a rumour: the queries below only bend around it after the
   * grate has gone, which is what keeps a locked level solid.
   */
  shaft: ShaftSpec | null = null;
  shaftOpen = false;

  private scene: THREE.Scene;
  /** keyed depth,cx,cz — two slabs can be standing at the same time */
  private chunks = new Map<string, ChunkData>();

  onChunkLoaded: ((c: ChunkData) => void) | null = null;
  onChunkUnloaded: ((c: ChunkData) => void) | null = null;

  constructor(seed: number, scene: THREE.Scene, depth = 0) {
    this.seed = seed;
    this.scene = scene;
    this.depth = depth;
  }

  /**
   * Move the whole world to another floor. Nothing survives: a level is one
   * biome end to end, so every chunk currently standing describes the wrong
   * building.
   */
  setDepth(depth: number): void {
    this.dispose();
    this.depth = depth;
    this.waterRise = 0;
    this.floodDepth = -1;
    this.propBlockers.length = 0;
    this.shaft = null;
    this.shaftOpen = false;
  }

  /**
   * Follow the player across a connection without tearing anything down. Both
   * floors stay built; all this moves is which one unqualified queries answer
   * from, and which one the streamer keeps at full radius.
   */
  setFocus(depth: number): void {
    this.depth = depth;
  }

  /** Raise (or lower) this level's water surface, everywhere, at once. */
  setWaterRise(metres: number): void {
    if (metres === this.waterRise) return;
    this.waterRise = metres;
    this.floodDepth = this.depth;
    for (const c of this.chunks.values()) {
      if (c.depth !== this.depth) continue; // the other floor is not the one filling up
      if (c.waterMesh && c.waterY !== null) c.waterMesh.position.y = c.waterY + metres;
    }
  }

  private key(d: number, cx: number, cz: number): string {
    return `${d},${cx},${cz}`;
  }

  getChunk(cx: number, cz: number, depth = this.depth): ChunkData | null {
    return this.chunks.get(this.key(depth, cx, cz)) ?? null;
  }

  /**
   * Every chunk currently built, on any floor. Rendering wants this — a frame
   * shows both sides of a connection at once. Gameplay usually does not: a
   * search that only compares distance in XZ will happily find the car parked
   * on the floor below you. Use focusChunks for those.
   */
  allChunks(): IterableIterator<ChunkData> {
    return this.chunks.values();
  }

  /** Only the floor the player is on. */
  *focusChunks(): IterableIterator<ChunkData> {
    for (const c of this.chunks.values()) {
      if (c.depth === this.depth) yield c;
    }
  }

  /**
   * Which slabs should be standing, and how much of each. The floor you are on
   * gets the full radius; the floor on the other side of a connection gets a
   * few chunks around the hole and nothing else, because at these fog densities
   * you cannot see further into it than that anyway.
   */
  private wanted(pcx: number, pcz: number): { depth: number; cx: number; cz: number; r: number }[] {
    const out = [{ depth: this.depth, cx: pcx, cz: pcz, r: LOAD_RADIUS }];
    const s = this.shaft;
    if (s) {
      const far = s.upper === this.depth ? s.lower : s.lower === this.depth ? s.upper : null;
      if (far !== null) {
        out.push({
          depth: far,
          cx: Math.floor(s.x / CHUNK),
          cz: Math.floor(s.z / CHUNK),
          r: NEIGHBOUR_RADIUS,
        });
      }
    }
    return out;
  }

  /** Stream chunks around the player. Generates at most one chunk per call to avoid hitches. */
  update(px: number, pz: number): void {
    const pcx = Math.floor(px / CHUNK);
    const pcz = Math.floor(pz / CHUNK);
    const wanted = this.wanted(pcx, pcz);

    // unload anything no slab wants any more
    for (const [k, c] of this.chunks) {
      const w = wanted.find((e) => e.depth === c.depth);
      // the hysteresis that stops a chunk thrashing on a chunk border is worth
      // it around the player; around a fixed hole there is nothing to thrash
      const margin = !w ? 0 : w.depth === this.depth ? UNLOAD_RADIUS - LOAD_RADIUS : 1;
      const drop = !w
        || Math.max(Math.abs(c.cx - w.cx), Math.abs(c.cz - w.cz)) > w.r + margin;
      if (drop) {
        if (c.group) this.scene.remove(c.group);
        disposeChunk(c);
        this.onChunkUnloaded?.(c);
        this.chunks.delete(k);
      }
    }

    // load the nearest missing chunk, focus slab first
    let best: { depth: number; cx: number; cz: number } | null = null;
    let bestD = Infinity;
    for (const w of wanted) {
      for (let dz = -w.r; dz <= w.r; dz++) {
        for (let dx = -w.r; dx <= w.r; dx++) {
          const cx = w.cx + dx;
          const cz = w.cz + dz;
          if (this.chunks.has(this.key(w.depth, cx, cz))) continue;
          // the floor you are standing on always wins a tie with the other one
          const d = dx * dx + dz * dz + (w.depth === this.depth ? 0 : 1000);
          if (d < bestD) { bestD = d; best = { depth: w.depth, cx, cz }; }
        }
      }
    }
    if (best) this.loadChunk(best.depth, best.cx, best.cz);
  }

  /** Force-generate everything around a point (used once at spawn). */
  preload(px: number, pz: number, radius = LOAD_RADIUS, depth = this.depth): void {
    const pcx = Math.floor(px / CHUNK);
    const pcz = Math.floor(pz / CHUNK);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (!this.chunks.has(this.key(depth, pcx + dx, pcz + dz))) {
          this.loadChunk(depth, pcx + dx, pcz + dz);
        }
      }
    }
  }

  private loadChunk(depth: number, cx: number, cz: number): void {
    const c = generateChunk(this.seed, depth, cx, cz);
    bakeSlab(c);
    c.group = buildChunk(c);
    if (c.waterMesh && c.waterY !== null) {
      c.waterMesh.position.y = c.waterY + (depth === this.floodDepth ? this.waterRise : 0);
    }
    this.scene.add(c.group);
    this.chunks.set(this.key(depth, cx, cz), c);
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

  /**
   * The level you are standing on. It no longer depends on where you stand —
   * a floor is one biome from end to end — but the callers all have a position
   * to hand and one day one of them might matter again.
   */
  biomeAt(y?: number): BiomeDef {
    return defForDepth(y === undefined ? this.depth : slabForY(y));
  }

  /** Is this the cell the connection goes through, with the way already open? */
  private inShaftColumn(gi: number, gj: number): boolean {
    const s = this.shaft;
    return !!s && this.shaftOpen && s.gi === gi && s.gj === gj;
  }

  /**
   * Resolve a global cell on the slab that owns `y`. Callers with nothing to
   * say about height get the floor the player is on, which is what every query
   * meant back when only one of them could be standing.
   */
  private cell(gi: number, gj: number, y?: number): { c: ChunkData; i: number; j: number } | null {
    const cx = Math.floor(gi / N);
    const cz = Math.floor(gj / N);
    const c = this.getChunk(cx, cz, y === undefined ? this.depth : slabForY(y));
    if (!c) return null;
    return { c, i: gi - cx * N, j: gj - cz * N };
  }

  isSolidCell(gi: number, gj: number, y?: number): boolean {
    const r = this.cell(gi, gj, y);
    if (!r) return true; // unloaded = solid
    return !!r.c.solid[r.j * N + r.i];
  }

  floorAt(gi: number, gj: number, y?: number): number {
    // the hole goes all the way through: no floor in this column above the
    // pipe's bottom mouth, on either of the floors it joins
    const s = this.shaft;
    if (s && this.inShaftColumn(gi, gj) && (y === undefined || y > s.bottom)) return -Infinity;
    const r = this.cell(gi, gj, y);
    if (!r || r.c.solid[r.j * N + r.i]) return Infinity;
    return r.c.floor[r.j * N + r.i];
  }

  ceilAt(gi: number, gj: number, y?: number): number {
    // and no ceiling under the drain, or the lower floor's roof would be a lid
    // on the pipe and you could never swim back up it
    const s = this.shaft;
    if (s && this.inShaftColumn(gi, gj) && y !== undefined && y < s.top) return Infinity;
    const r = this.cell(gi, gj, y);
    return r ? r.c.ceil - r.c.ceilDrop[r.j * N + r.i] : Infinity;
  }

  /** Water surface height in this cell, or null. */
  waterSurfaceAt(x: number, z: number, y?: number): number | null {
    const gi = Math.floor(x / CELL);
    const gj = Math.floor(z / CELL);
    // Inside the pipe the water is one column, poured in from the floor above
    // and held up by it — so the surface that matters down there is the upper
    // floor's, not the one belonging to the slab your feet are technically in.
    const s = this.shaft;
    if (s && this.inShaftColumn(gi, gj) && y !== undefined && y < s.top) {
      const up = this.getChunk(Math.floor(gi / N), Math.floor(gj / N), s.upper);
      if (up?.waterY != null) return up.waterY + (s.upper === this.floodDepth ? this.waterRise : 0);
    }
    const r = this.cell(gi, gj, y);
    if (!r || r.c.waterY === null) return null;
    const rise = r.c.depth === this.floodDepth ? this.waterRise : 0;
    return r.c.water[r.j * N + r.i] ? r.c.waterY + rise : null;
  }

  /** Wall on the vertical grid line gx, segment gj. */
  hasWallV(gx: number, gj: number, y?: number): boolean {
    const d = y === undefined ? this.depth : slabForY(y);
    const cz = Math.floor(gj / N);
    const j = gj - cz * N;
    // owning chunk has lineX = gx - cx*N in [0..16]
    let cx = Math.floor(gx / N);
    let lineX = gx - cx * N;
    let c = this.getChunk(cx, cz, d);
    if (!c && lineX === 0) { // border line is duplicated in the -x neighbour as line N
      cx -= 1; lineX = N;
      c = this.getChunk(cx, cz, d);
    }
    if (!c) return true;
    return !!c.wallsV[lineX * N + j];
  }

  hasWallH(gi: number, gz: number, y?: number): boolean {
    const d = y === undefined ? this.depth : slabForY(y);
    const cx = Math.floor(gi / N);
    const i = gi - cx * N;
    let cz = Math.floor(gz / N);
    let lineZ = gz - cz * N;
    let c = this.getChunk(cx, cz, d);
    if (!c && lineZ === 0) {
      cz -= 1; lineZ = N;
      c = this.getChunk(cx, cz, d);
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

    // Inside the pipe, the pipe is the only thing there is. One cell wide, so
    // its four edges are ordinary wall boxes and the circle resolver contains
    // you without anything here needing to know what a cylinder is.
    const shaft = this.shaft;
    if (shaft && this.shaftOpen && insidePipe(shaft, feetY)) {
      const x0 = shaft.gi * CELL;
      const z0 = shaft.gj * CELL;
      out.push({ minX: x0 - T, maxX: x0 + T, minZ: z0, maxZ: z0 + CELL });
      out.push({ minX: x0 + CELL - T, maxX: x0 + CELL + T, minZ: z0, maxZ: z0 + CELL });
      out.push({ minX: x0, maxX: x0 + CELL, minZ: z0 - T, maxZ: z0 + T });
      out.push({ minX: x0, maxX: x0 + CELL, minZ: z0 + CELL - T, maxZ: z0 + CELL + T });
      return;
    }

    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ci = gi + di;
        const cj = gj + dj;
        const f = this.floorAt(ci, cj, feetY);
        if (f === -Infinity) continue; // the way down; not something to bump into
        if (!isFinite(f) || f > feetY + maxStep) {
          out.push({ minX: ci * CELL, maxX: (ci + 1) * CELL, minZ: cj * CELL, maxZ: (cj + 1) * CELL });
          continue;
        }
        // walls on this cell's west and north edges
        if (this.hasWallV(ci, cj, feetY)) {
          out.push({ minX: ci * CELL - T, maxX: ci * CELL + T, minZ: cj * CELL, maxZ: (cj + 1) * CELL });
        }
        if (this.hasWallH(ci, cj, feetY)) {
          out.push({ minX: ci * CELL, maxX: (ci + 1) * CELL, minZ: cj * CELL - T, maxZ: cj * CELL + T });
        }
        // east/south edges of the outer ring
        if (di === 1 && this.hasWallV(ci + 1, cj, feetY)) {
          out.push({ minX: (ci + 1) * CELL - T, maxX: (ci + 1) * CELL + T, minZ: cj * CELL, maxZ: (cj + 1) * CELL });
        }
        if (dj === 1 && this.hasWallH(ci, cj + 1, feetY)) {
          out.push({ minX: ci * CELL, maxX: (ci + 1) * CELL, minZ: (cj + 1) * CELL - T, maxZ: (cj + 1) * CELL + T });
        }
      }
    }
    // whatever the descent has left standing in the way
    for (const b of this.propBlockers) {
      if (b.maxX < x - 2 || b.minX > x + 2 || b.maxZ < z - 2 || b.minZ > z + 2) continue;
      out.push(b);
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
      const f = this.floorAt(gi, gj, feetY);
      if (isFinite(f) && f <= feetY + maxStep) g = Math.max(g, f);
    }
    if (g === -Infinity) {
      const f = this.floorAt(Math.floor(x / CELL), Math.floor(z / CELL), feetY);
      // a hole is not a missing chunk: keep falling rather than snapping to 0
      if (f === -Infinity) return -Infinity;
      g = isFinite(f) ? f : 0;
    }
    return g;
  }

  ceilHeight(x: number, z: number, y?: number): number {
    return this.ceilAt(Math.floor(x / CELL), Math.floor(z / CELL), y);
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

  /**
   * Distance along the XZ segment to the first wall / solid cell, or null if
   * nothing blocks it. Same DDA as lineBlocked, but reports where it hit.
   */
  raycastWall(ax: number, az: number, bx: number, bz: number): number | null {
    let gi = Math.floor(ax / CELL);
    let gj = Math.floor(az / CELL);
    const ti = Math.floor(bx / CELL);
    const tj = Math.floor(bz / CELL);
    if (this.isSolidCell(gi, gj)) return 0;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const stepI = dx > 0 ? 1 : -1;
    const stepJ = dz > 0 ? 1 : -1;
    let tMaxX = dx !== 0 ? (((dx > 0 ? gi + 1 : gi) * CELL) - ax) / dx : Infinity;
    let tMaxZ = dz !== 0 ? (((dz > 0 ? gj + 1 : gj) * CELL) - az) / dz : Infinity;
    const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    for (let guard = 0; guard < 80; guard++) {
      if (gi === ti && gj === tj) return null;
      let tCross: number;
      if (tMaxX < tMaxZ) {
        tCross = tMaxX;
        if (this.hasWallV(dx > 0 ? gi + 1 : gi, gj)) return tCross * len;
        gi += stepI;
        tMaxX += tDeltaX;
      } else {
        tCross = tMaxZ;
        if (this.hasWallH(gi, dz > 0 ? gj + 1 : gj)) return tCross * len;
        gj += stepJ;
        tMaxZ += tDeltaZ;
      }
      if (this.isSolidCell(gi, gj)) return tCross * len;
    }
    return null;
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
      const k = r.j * N + r.i;
      if (r.c.solid[k]) continue;
      // a wet floor is fine to stand on; anything you could swim in is not
      const surface = r.c.waterY === null
        ? null
        : r.c.waterY + (r.c.depth === this.floodDepth ? this.waterRise : 0);
      if (r.c.water[k] && surface !== null && surface > r.c.floor[k] + 0.55) continue;
      if (filter && !filter(r.c, r.c.biome)) continue;
      const f = r.c.floor[r.j * N + r.i];
      return new THREE.Vector3((gi + 0.5) * CELL, f, (gj + 0.5) * CELL);
    }
    return null;
  }
}
