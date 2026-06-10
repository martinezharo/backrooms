// Shared building blocks for procedural monster bodies: skin textures,
// organic lathe shapes, jointed limbs and static-geometry merging.
// Textures are cached per look; materials are always fresh per instance
// because enemies tint their own materials for the hit flash.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng';

const texCache = new Map<string, THREE.CanvasTexture>();
let bumpTex: THREE.CanvasTexture | null = null;

export interface SkinOpts {
  base: string;
  mottle: string;
  veins?: boolean;
  /** vertical grime drips, e.g. on the Partygoer's stained body */
  streaks?: boolean;
  seed?: number;
  roughness?: number;
}

export function skinTexture(opts: SkinOpts): THREE.CanvasTexture {
  const key = `${opts.base}|${opts.mottle}|${opts.veins ? 1 : 0}|${opts.streaks ? 1 : 0}|${opts.seed ?? 0}`;
  const hit = texCache.get(key);
  if (hit) return hit;

  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const rng = mulberry32(opts.seed ?? 7);

  ctx.fillStyle = opts.base;
  ctx.fillRect(0, 0, size, size);

  // translucent mottle blobs — bruised, uneven flesh
  for (let i = 0; i < 420; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 2 + rng() * 9;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, opts.mottle);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.05 + rng() * 0.1;
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;

  if (opts.veins) {
    ctx.strokeStyle = 'rgba(60, 30, 40, 0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      let x = rng() * size;
      let y = rng() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (rng() - 0.5) * 28;
        y += (rng() - 0.3) * 24;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  if (opts.streaks) {
    for (let i = 0; i < 22; i++) {
      const x = rng() * size;
      const w = 2 + rng() * 7;
      const grad = ctx.createLinearGradient(0, 0, 0, size);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(30,20,10,0.3)');
      ctx.globalAlpha = 0.25 + rng() * 0.3;
      ctx.fillStyle = grad;
      ctx.fillRect(x, rng() * size * 0.4, w, size);
    }
    ctx.globalAlpha = 1;
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}

/** grayscale noise reused as a bump map — cheap pores/sinew */
export function skinBumpTexture(): THREE.CanvasTexture {
  if (bumpTex) return bumpTex;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const rng = mulberry32(99);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + rng() * 70;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  bumpTex = new THREE.CanvasTexture(c);
  bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
  return bumpTex;
}

export function skinMaterial(opts: SkinOpts): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: skinTexture(opts),
    bumpMap: skinBumpTexture(),
    bumpScale: 0.015,
    roughness: opts.roughness ?? 0.65,
  });
}

/** Organic solid of revolution; profile is [radius, y] pairs bottom→top. */
export function latheGeo(profile: [number, number][], segments = 14): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y));
  return new THREE.LatheGeometry(pts, segments);
}

/** Bake a transform into a geometry (for pre-merge placement). */
export function xform(
  geo: THREE.BufferGeometry,
  x: number, y: number, z: number,
  rx = 0, ry = 0, rz = 0,
  sx = 1, sy = sx, sz = sx,
): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  geo.applyMatrix4(m);
  return geo;
}

/** Collapse pre-placed geometries into a single mesh (1 draw call). */
export function mergeStatic(geos: THREE.BufferGeometry[], mat: THREE.Material): THREE.Mesh {
  const merged = mergeGeometries(geos, false)!;
  for (const g of geos) g.dispose();
  return new THREE.Mesh(merged, mat);
}

export interface LimbSeg {
  len: number;
  r0: number;
  r1: number;
}

export interface Limb {
  root: THREE.Group;
  /** one pivot per segment: joints[0] = shoulder/hip, joints[1] = elbow/knee */
  joints: THREE.Group[];
  /** attachment point past the last segment (hand/foot) */
  end: THREE.Group;
}

/** Chain of pivots, each holding a tapered segment hanging from its joint —
 *  two-segment arms/legs with real elbows and knees. */
export function limb(segs: LimbSeg[], mat: THREE.Material): Limb {
  const root = new THREE.Group();
  const joints: THREE.Group[] = [];
  let parent: THREE.Group = root;
  for (const s of segs) {
    const joint = new THREE.Group();
    parent.add(joint);
    const geo = new THREE.CylinderGeometry(s.r0, s.r1, s.len, 7);
    geo.translate(0, -s.len / 2, 0);
    joint.add(new THREE.Mesh(geo, mat));
    joints.push(joint);
    const next = new THREE.Group();
    next.position.y = -s.len;
    joint.add(next);
    parent = next;
  }
  return { root, joints, end: parent };
}
