// The way down.
//
// Every floor charges a different toll. One wants you to find the place where
// the wallpaper has gone soft and push; one wants the whole car park screaming
// at once; one wants you to drown the level you're standing in; one wants ten
// seconds of your breath at a time; one wants four digits somebody left on a
// wall. Where each of those things is, is decided by the seed alone, so any
// chunk can work out on its own whether it holds one.

import * as THREE from 'three';
import { CELL, CHUNK } from '../core/constants';
import { hash3, mulberry32 } from '../core/rng';
import { getCodeMaterial, getWorldMaterials } from '../rendering/Textures';
import { BiomeId, biomeForDepth } from './Biomes';
import type { ChunkData } from './Chunk';
import type { World } from './World';

/** What the way down looks like on a given floor. */
export type DescentKind =
  | 'softwall'  // L0  — the wallpaper gives
  | 'shutter'   // L1  — the roller door over the service ramp
  | 'drain'     // L37 — the bottom of the deep pool
  | 'hatch'     // L7  — a bolted hatch five metres under
  | 'door'      // L2  — a stairwell door with a keypad
  | 'portal';   // L!  — the way out, which is not down

/** A second landmark some floors need: the thing that unlocks the first one. */
export type SubKind = 'valve' | 'code';

export interface DescentSpot {
  kind: DescentKind;
  /** the prop itself */
  x: number; y: number; z: number;
  /** yaw the prop faces */
  angle: number;
  /** where the player has to stand (or swim, or fall) to use it */
  tx: number; ty: number; tz: number;
}

export interface SubSpot {
  kind: SubKind;
  x: number; y: number; z: number;
  angle: number;
}

export interface DescentLayout {
  exit: { cx: number; cz: number };
  sub: { cx: number; cz: number; kind: SubKind } | null;
  /** the four digits on the wall, for the floor that has a keypad */
  code: string;
}

const KIND_BY_BIOME: Record<BiomeId, DescentKind> = {
  [BiomeId.Level0]: 'softwall',
  [BiomeId.Level1]: 'shutter',
  [BiomeId.Level37]: 'drain',
  [BiomeId.Level7]: 'hatch',
  [BiomeId.Level2]: 'door',
  [BiomeId.LevelRun]: 'portal',
};

export function descentKind(depth: number): DescentKind {
  return KIND_BY_BIOME[biomeForDepth(depth)];
}

const SUB_BY_BIOME: Partial<Record<BiomeId, SubKind>> = {
  [BiomeId.Level37]: 'valve',
  [BiomeId.Level2]: 'code',
};

/** chunk-distance rings (1 chunk = 32 m) */
const EXIT_MIN = 4;
const EXIT_MAX = 7;
const SUB_MIN = 3;
const SUB_MAX = 6;

const cache = new Map<string, DescentLayout>();

export function descentLayout(seed: number, depth: number): DescentLayout {
  const key = `${seed}:${depth}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rng = mulberry32(hash3(seed, 0xde5ce17, depth, 0x2b));
  const base = rng() * Math.PI * 2;

  const ring = (angle: number, min: number, max: number) => {
    const d = min + rng() * (max - min);
    const cx = Math.round(Math.cos(angle) * d);
    const cz = Math.round(Math.sin(angle) * d);
    // never on the chunk you woke up in
    return cx === 0 && cz === 0 ? { cx: min, cz: 0 } : { cx, cz };
  };

  const exit = ring(base, EXIT_MIN, EXIT_MAX);
  // the unlock sits in its own direction, so finding it is a separate walk
  const subKind = SUB_BY_BIOME[biomeForDepth(depth)];
  let sub = subKind
    ? { ...ring(base + Math.PI * (0.6 + rng() * 0.8), SUB_MIN, SUB_MAX), kind: subKind }
    : null;
  // two sites carving aprons out of the same chunk would fight over the floor
  if (sub && sub.cx === exit.cx && sub.cz === exit.cz) sub = { ...sub, cx: sub.cx + 2 };

  // Four digits, never starting with a zero — a zero on a wall reads as an O.
  const digits = mulberry32(hash3(seed, 0xc0de, depth, 0x77));
  let code = String(1 + Math.floor(digits() * 9));
  for (let i = 0; i < 3; i++) code += String(Math.floor(digits() * 10));

  const layout: DescentLayout = { exit, sub, code };
  cache.set(key, layout);
  return layout;
}

export function isDescentChunk(seed: number, depth: number, cx: number, cz: number): boolean {
  const e = descentLayout(seed, depth).exit;
  return e.cx === cx && e.cz === cz;
}

export function subSiteHere(seed: number, depth: number, cx: number, cz: number): SubKind | null {
  const s = descentLayout(seed, depth).sub;
  return s && s.cx === cx && s.cz === cz ? s.kind : null;
}

export function chunkCentre(cx: number, cz: number): THREE.Vector3 {
  return new THREE.Vector3(cx * CHUNK + CHUNK / 2, 0, cz * CHUNK + CHUNK / 2);
}

// ---------------------------------------------------------------- props

/** Everything the descent props need to know about the run, once per frame. */
export interface PropState {
  /** 0..1 — how far the floor has been talked into opening */
  progress: number;
  open: boolean;
  time: number;
  dt: number;
}

const _metalMat = () => getWorldMaterials().metal;

function box(
  w: number, h: number, d: number, mat: THREE.Material,
  x = 0, y = 0, z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/**
 * The physical thing at the bottom of a floor's objective: a shutter that
 * rolls, a wheel that turns, a wall that breathes. It owns its own meshes and
 * animates itself from the state Game feeds it — nothing here decides whether
 * the way down is open, it only shows the answer.
 */
export class DescentProp {
  readonly spot: DescentSpot;
  readonly group = new THREE.Group();
  /** where the player has to be */
  readonly target = new THREE.Vector3();
  /** a solid the world consults while the way down is still shut */
  blocker: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

  private moving: THREE.Object3D[] = [];
  private wheel: THREE.Object3D | null = null;
  private glow: THREE.PointLight | null = null;
  private softGeo: THREE.PlaneGeometry | null = null;
  private softRest: Float32Array | null = null;
  private disposables: THREE.BufferGeometry[] = [];

  constructor(scene: THREE.Scene, spot: DescentSpot) {
    this.spot = spot;
    this.target.set(spot.tx, spot.ty, spot.tz);
    this.group.position.set(spot.x, spot.y, spot.z);
    this.group.rotation.y = spot.angle;

    switch (spot.kind) {
      case 'softwall': this.buildSoftWall(); break;
      case 'shutter': this.buildShutter(); break;
      case 'drain': this.buildDrain(); break;
      case 'hatch': this.buildHatch(); break;
      case 'door': this.buildDoor(); break;
      case 'portal': break; // the portal builds itself, elsewhere
    }
    scene.add(this.group);
  }

  private track(o: THREE.Object3D): void {
    o.traverse((c) => { if (c instanceof THREE.Mesh) this.disposables.push(c.geometry); });
  }

  // ---- L0: the wall that gives -------------------------------------------

  /**
   * A patch of wallpaper on its own mesh, sitting a hair proud of the wall
   * behind it, pushed out from underneath by something breathing.
   */
  private buildSoftWall(): void {
    const mat = getWorldMaterials().wall.clone();
    mat.color.setHex(0xd8c98a);
    const geo = new THREE.PlaneGeometry(3.2, 2.4, 14, 12);
    this.softGeo = geo;
    this.softRest = Float32Array.from(geo.getAttribute('position').array);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 1.35, 0.02);
    this.group.add(mesh);
    // the seam where the paper has lifted away from the wall
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(1.45, 1.62, 32),
      new THREE.MeshBasicMaterial({ color: 0x120e06, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    );
    rim.position.set(0, 1.35, 0.015);
    rim.scale.set(1, 0.78, 1);
    this.group.add(rim);
    this.track(this.group);
  }

  // ---- L1: the roller shutter over the service ramp -----------------------

  private buildShutter(): void {
    const metal = _metalMat();
    const leaf = new THREE.Group();
    // corrugation: a stack of slats, so it reads as a shutter even head-on
    for (let i = 0; i < 14; i++) {
      leaf.add(box(4.6, 0.2, 0.09, metal, 0, 0.14 + i * 0.21, 0));
    }
    leaf.add(box(4.7, 0.16, 0.16, metal, 0, 0.06, 0));
    this.group.add(leaf);
    this.moving.push(leaf);
    // the frame stays put when the leaf goes up
    const frame = new THREE.MeshStandardMaterial({ color: 0x9a8b3e, roughness: 0.6, metalness: 0.4 });
    this.group.add(box(0.22, 3.2, 0.34, frame, -2.42, 1.6, 0));
    this.group.add(box(0.22, 3.2, 0.34, frame, 2.42, 1.6, 0));
    this.group.add(box(5.1, 0.42, 0.4, frame, 0, 3.15, 0));
    // the hazard bar you smack to wake it up
    const plate = new THREE.MeshStandardMaterial({ color: 0xc4a52a, roughness: 0.5, metalness: 0.5 });
    this.group.add(box(0.55, 0.34, 0.12, plate, 2.42, 1.25, 0.22));
    this.glow = new THREE.PointLight(0xffc24a, 0, 9, 1.8);
    this.glow.position.set(2.42, 1.25, 0.5);
    this.group.add(this.glow);
    this.blocker = {
      minX: this.spot.x - 2.5, maxX: this.spot.x + 2.5,
      minZ: this.spot.z - 0.3, maxZ: this.spot.z + 0.3,
    };
    if (Math.abs(Math.cos(this.spot.angle)) < 0.5) {
      this.blocker = {
        minX: this.spot.x - 0.3, maxX: this.spot.x + 0.3,
        minZ: this.spot.z - 2.5, maxZ: this.spot.z + 2.5,
      };
    }
    this.track(this.group);
  }

  // ---- L37: the drain at the bottom of the deep pool ----------------------

  private buildDrain(): void {
    const metal = _metalMat();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.11, 8, 28), metal);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    this.group.add(ring);
    // the grate: bars across the mouth, which slide apart when it lets go
    const bars = new THREE.Group();
    for (let i = -3; i <= 3; i++) {
      bars.add(box(0.1, 0.08, 2.1, metal, i * 0.3, 0.04, 0));
    }
    this.group.add(bars);
    this.moving.push(bars);
    // the dark under it
    const mouth = new THREE.Mesh(
      new THREE.CircleGeometry(1.12, 28),
      new THREE.MeshBasicMaterial({ color: 0x02100e }),
    );
    mouth.rotation.x = -Math.PI / 2;
    mouth.position.y = -0.04;
    this.group.add(mouth);
    this.track(this.group);
  }

  // ---- L7: the hatch, five metres down ------------------------------------

  private buildHatch(): void {
    const metal = _metalMat();
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.16, 24), metal);
    rim.position.y = 0.08;
    this.group.add(rim);
    const lid = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.14, 24), metal);
    disc.position.y = 0.2;
    lid.add(disc);
    // the wheel that has not been turned in a very long time
    const wheel = new THREE.Group();
    const torus = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.055, 7, 22), metal);
    torus.rotation.x = Math.PI / 2;
    wheel.add(torus);
    for (let i = 0; i < 4; i++) {
      const spoke = box(1.02, 0.06, 0.08, metal);
      spoke.rotation.y = (i * Math.PI) / 4;
      wheel.add(spoke);
    }
    wheel.position.y = 0.34;
    lid.add(wheel);
    this.wheel = wheel;
    this.group.add(lid);
    this.moving.push(lid);
    const mouth = new THREE.Mesh(
      new THREE.CircleGeometry(0.93, 24),
      new THREE.MeshBasicMaterial({ color: 0x000407 }),
    );
    mouth.rotation.x = -Math.PI / 2;
    mouth.position.y = 0.03;
    this.group.add(mouth);
    this.glow = new THREE.PointLight(0x8fd8ff, 0, 7, 2);
    this.glow.position.y = 0.6;
    this.group.add(this.glow);
    this.track(this.group);
  }

  // ---- L2: the stairwell door and its keypad ------------------------------

  private buildDoor(): void {
    const metal = _metalMat();
    const paint = new THREE.MeshStandardMaterial({ color: 0x4d5a4a, roughness: 0.72, metalness: 0.25 });
    // hinged leaf: a pivot group so it swings from its edge, not its middle
    const hinge = new THREE.Group();
    hinge.position.set(-0.55, 0, 0);
    const leaf = box(1.1, 2.05, 0.09, paint, 0.55, 1.03, 0);
    hinge.add(leaf);
    hinge.add(box(0.1, 0.06, 0.12, metal, 1.0, 1.0, 0.08)); // handle
    this.group.add(hinge);
    this.moving.push(hinge);
    // frame + the sign nobody updated
    this.group.add(box(0.12, 2.25, 0.16, metal, -0.62, 1.12, 0));
    this.group.add(box(0.12, 2.25, 0.16, metal, 0.62, 1.12, 0));
    this.group.add(box(1.36, 0.12, 0.16, metal, 0, 2.19, 0));
    // keypad, at the height a hand finds it
    const pad = new THREE.MeshStandardMaterial({ color: 0x23241f, roughness: 0.5, metalness: 0.4 });
    this.group.add(box(0.24, 0.34, 0.07, pad, 0.92, 1.28, 0.06));
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x300808, emissive: 0xff3020, emissiveIntensity: 2 }),
    );
    led.position.set(0.92, 1.43, 0.11);
    this.group.add(led);
    this.moving.push(led); // recoloured on open
    this.glow = new THREE.PointLight(0xff4028, 1.6, 4, 2);
    this.glow.position.set(0.92, 1.43, 0.3);
    this.group.add(this.glow);
    this.blocker = {
      minX: this.spot.x - 0.7, maxX: this.spot.x + 0.7,
      minZ: this.spot.z - 0.25, maxZ: this.spot.z + 0.25,
    };
    if (Math.abs(Math.cos(this.spot.angle)) < 0.5) {
      this.blocker = {
        minX: this.spot.x - 0.25, maxX: this.spot.x + 0.25,
        minZ: this.spot.z - 0.7, maxZ: this.spot.z + 0.7,
      };
    }
    this.track(this.group);
  }

  // ------------------------------------------------------------- animation

  update(s: PropState): void {
    switch (this.spot.kind) {
      case 'softwall': {
        // breathing, and it breathes harder the more of it you have pushed in
        const g = this.softGeo!;
        const rest = this.softRest!;
        const pos = g.getAttribute('position') as THREE.BufferAttribute;
        const swell = 0.09 + s.progress * 0.55;
        const beat = 0.55 + 0.45 * Math.sin(s.time * (1.4 + s.progress * 4));
        for (let i = 0; i < pos.count; i++) {
          const x = rest[i * 3];
          const y = rest[i * 3 + 1];
          const falloff = Math.max(0, 1 - (x * x) / 2.9 - (y * y) / 1.7);
          pos.setZ(i, rest[i * 3 + 2] + falloff * falloff * swell * beat);
        }
        pos.needsUpdate = true;
        g.computeVertexNormals();
        break;
      }
      case 'shutter': {
        // rolls up once, and stays up
        const lift = s.open ? 2.85 : 0;
        const leaf = this.moving[0];
        leaf.position.y += (lift - leaf.position.y) * Math.min(1, s.dt * 0.9);
        if (this.glow) this.glow.intensity = s.open ? 0 : 3 + Math.sin(s.time * 6) * 2.6;
        break;
      }
      case 'drain': {
        const bars = this.moving[0];
        bars.position.y = s.open ? -0.6 : 0;
        bars.rotation.y = s.progress * Math.PI * 1.6;
        break;
      }
      case 'hatch': {
        if (this.wheel) this.wheel.rotation.y = s.progress * Math.PI * 6;
        const lid = this.moving[0];
        const target = s.open ? -1.4 : 0;
        lid.position.y += (target - lid.position.y) * Math.min(1, s.dt * 1.4);
        if (this.glow) this.glow.intensity = s.open ? 4 : s.progress * 1.2;
        break;
      }
      case 'door': {
        const hinge = this.moving[0];
        const target = s.open ? -1.9 : 0;
        hinge.rotation.y += (target - hinge.rotation.y) * Math.min(1, s.dt * 1.1);
        const led = this.moving[1] as THREE.Mesh;
        const mat = led.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(s.open ? 0x30ff60 : 0xff3020);
        if (this.glow) {
          this.glow.color.setHex(s.open ? 0x40ff70 : 0xff4028);
          this.glow.intensity = s.open ? 2.2 : 1.6;
        }
        break;
      }
      case 'portal': break;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.disposables) g.dispose();
    this.disposables.length = 0;
    this.softGeo = null;
  }
}

/** The valve wheel / the wall with the code on it — one small prop, no state. */
export class SubProp {
  readonly spot: SubSpot;
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  private wheel: THREE.Object3D | null = null;
  private geos: THREE.BufferGeometry[] = [];

  constructor(scene: THREE.Scene, spot: SubSpot, code: string) {
    this.spot = spot;
    this.position.set(spot.x, spot.y, spot.z);
    this.group.position.copy(this.position);
    this.group.rotation.y = spot.angle;
    if (spot.kind === 'code') {
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), getCodeMaterial(code));
      decal.position.z = 0.012;
      this.group.add(decal);
    }
    if (spot.kind === 'valve') {
      const metal = _metalMat();
      this.group.add(box(0.3, 0.3, 0.34, metal, 0, 0, 0.1));
      const wheel = new THREE.Group();
      const torus = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 7, 22), metal);
      wheel.add(torus);
      for (let i = 0; i < 3; i++) {
        const spoke = box(0.84, 0.05, 0.05, metal);
        spoke.rotation.z = (i * Math.PI) / 3;
        wheel.add(spoke);
      }
      wheel.position.z = 0.3;
      this.group.add(wheel);
      this.wheel = wheel;
      // the pipe it is bolted to, running away into the wall
      this.group.add(box(0.16, 1.9, 0.16, metal, 0, -0.1, -0.02));
    }
    this.group.traverse((c) => { if (c instanceof THREE.Mesh) this.geos.push(c.geometry); });
    scene.add(this.group);
  }

  update(progress: number): void {
    if (this.wheel) this.wheel.rotation.z = progress * Math.PI * 5;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    this.geos.length = 0;
  }
}

/** Grid cell centre in world space — sites are always placed on cell centres. */
export function cellCentre(cx: number, cz: number, i: number, j: number): [number, number] {
  return [cx * CHUNK + (i + 0.5) * CELL, cz * CHUNK + (j + 0.5) * CELL];
}

/**
 * Watches chunk streaming for this floor's two landmarks and keeps them alive
 * from then on — like the portal, they must never blink out of existence just
 * because you walked far enough away to unload the chunk they stand in.
 */
export class DescentManager {
  prop: DescentProp | null = null;
  sub: SubProp | null = null;

  private scene: THREE.Scene;
  private world: World;
  private code: string;
  /** Last known state, including while the landmark's chunk is unloaded. */
  private open = false;

  constructor(scene: THREE.Scene, world: World, code: string) {
    this.scene = scene;
    this.world = world;
    this.code = code;
    const prev = world.onChunkLoaded;
    world.onChunkLoaded = (c) => { prev?.(c); this.chunkLoaded(c); };
  }

  private chunkLoaded(c: ChunkData): void {
    if (c.descent && !this.prop && c.descent.kind !== 'portal') {
      this.prop = new DescentProp(this.scene, c.descent);
      if (this.prop.blocker && !this.open) this.world.propBlockers.push(this.prop.blocker);
    }
    if (c.sub && !this.sub) this.sub = new SubProp(this.scene, c.sub, this.code);
  }

  /** The shutter is up / the door is open: stop standing in the way. */
  clearBlocker(): void {
    const b = this.prop?.blocker;
    if (!b) return;
    const i = this.world.propBlockers.indexOf(b);
    if (i >= 0) this.world.propBlockers.splice(i, 1);
  }

  update(state: PropState, subProgress: number): void {
    if (state.open && !this.open) this.clearBlocker();
    this.open = state.open;
    this.prop?.update(state);
    this.sub?.update(subProgress);
  }

  /** A new floor: forget everything the last one had standing in it. */
  reset(code: string): void {
    this.prop?.dispose();
    this.sub?.dispose();
    this.prop = null;
    this.sub = null;
    this.code = code;
    this.open = false;
  }
}
