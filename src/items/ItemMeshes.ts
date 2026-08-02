// Procedural 3D models for every item — primitives only, no assets.

import * as THREE from 'three';

const matCache = new Map<string, THREE.Material>();

function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = matCache.get(key);
  if (!m) { m = make(); matCache.set(key, m); }
  return m;
}

const steel = () => mat('steel', () => new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.9 }));
const darkSteel = () => mat('darkSteel', () => new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.5, metalness: 0.8 }));
const redPaint = () => mat('redPaint', () => new THREE.MeshStandardMaterial({ color: 0x9b1f15, roughness: 0.45, metalness: 0.3 }));
const blackPlastic = () => mat('blackPlastic', () => new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.7 }));
const wood = () => mat('wood', () => new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.85 }));
const brass = () => mat('brass', () => new THREE.MeshStandardMaterial({ color: 0xb08d3c, roughness: 0.4, metalness: 0.85 }));

// The bottle is the one item you look at while it changes, so it gets a real
// profile instead of two cylinders. Everything inside it is opaque and the
// glass shell is the only transparent mesh: two overlapping transparent hulls
// have no stable draw order, which is what made the liquid strobe.
const bottleGlass = () => mat('bottleGlass', () => new THREE.MeshStandardMaterial({
  color: 0x40682f, roughness: 0.06, metalness: 0.0,
  transparent: true, opacity: 0.42, depthWrite: false, side: THREE.FrontSide,
}));
// water read through green glass: desaturated, never bright
const bottleLiquid = () => mat('bottleLiquid', () => new THREE.MeshStandardMaterial({
  color: 0x24503c, roughness: 0.12, metalness: 0.1,
}));
// the surface is the same water, just wet and catching a highlight
const bottleSurface = () => mat('bottleSurface', () => new THREE.MeshStandardMaterial({
  color: 0x3a6d55, roughness: 0.04, metalness: 0.45,
}));
// kraft paper, grubby: a bright label blows out the moment the torch is on it
const bottleLabel = () => mat('bottleLabel', () => new THREE.MeshStandardMaterial({
  color: 0x93856a, roughness: 1,
}));
const bottleCap = () => mat('bottleCap', () => new THREE.MeshStandardMaterial({
  color: 0x8f8a80, roughness: 0.35, metalness: 0.8,
}));

/** Silhouette of the bottle, in metres: [radius, height] up the axis. */
const BOTTLE_PROFILE: [number, number][] = [
  [0.000, -0.146], [0.026, -0.146], [0.040, -0.136], [0.042, -0.126],
  [0.042, 0.016], [0.041, 0.036], [0.035, 0.058], [0.026, 0.079],
  [0.019, 0.098], [0.017, 0.116], [0.017, 0.134], [0.021, 0.140],
  [0.020, 0.150], [0.000, 0.150],
];
const BOTTLE_FLOOR = -0.132;   // inside face of the base
const BOTTLE_BRIM = 0.072;     // a full one is filled into the shoulder
const BOTTLE_GLASS = 0.0035;   // wall thickness

/** Inner radius of the bottle at a height up the axis. */
function bottleBore(y: number): number {
  for (let i = 1; i < BOTTLE_PROFILE.length; i++) {
    const [r0, y0] = BOTTLE_PROFILE[i - 1];
    const [r1, y1] = BOTTLE_PROFILE[i];
    if (y1 > y0 && y <= y1) {
      const r = r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
      return Math.max(0.001, r - BOTTLE_GLASS);
    }
  }
  return 0.001;
}

/**
 * The liquid as a solid of revolution against the inside wall, cut flat at the
 * level. Following the real bore is what makes a full bottle show a thin line
 * up in the shoulder instead of a lid-shaped slab across the body.
 */
function bottleLiquidGeometry(level: number): THREE.LatheGeometry {
  const pts = [new THREE.Vector2(0, BOTTLE_FLOOR)];
  for (const [r, y] of BOTTLE_PROFILE) {
    if (y > BOTTLE_FLOOR && y < level) pts.push(new THREE.Vector2(Math.max(0.001, r - BOTTLE_GLASS), y));
  }
  pts.push(new THREE.Vector2(bottleBore(level), level));
  return new THREE.LatheGeometry(pts, 28);
}

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

function cyl(rTop: number, rBot: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 12): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), m);
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * Build the model for an item id. ~30–40 cm scale, centred at origin.
 * `fill` only means anything to the bottle: 0..1 of liquid left in it.
 */
export function buildItemMesh(id: string, fill = 0): THREE.Group {
  const g = new THREE.Group();
  switch (id) {
    case 'wrench': {
      const handle = cyl(0.022, 0.026, 0.34, redPaint());
      handle.rotation.z = Math.PI / 2;
      g.add(handle);
      g.add(box(0.06, 0.1, 0.035, steel(), 0.19, 0.02, 0));
      g.add(box(0.05, 0.045, 0.035, steel(), 0.2, 0.095, 0));
      break;
    }
    case 'extinguisher': {
      g.add(cyl(0.075, 0.075, 0.4, redPaint()));
      g.add(cyl(0.03, 0.03, 0.05, darkSteel(), 0, 0.225, 0));
      g.add(box(0.03, 0.02, 0.12, darkSteel(), 0, 0.26, 0.04));
      const hose = cyl(0.012, 0.012, 0.22, blackPlastic(), 0.07, 0.05, 0);
      hose.rotation.z = 0.5;
      g.add(hose);
      break;
    }
    case 'bottle': {
      const level = Math.max(0, Math.min(1, fill));
      // Liquid first: opaque, depth-written, so the glass simply blends over it
      // from any angle. Drawn as a cylinder against the straight body wall,
      // with a brighter disc for the surface catching the light.
      if (level > 0.01) {
        const top = BOTTLE_FLOOR + (BOTTLE_BRIM - BOTTLE_FLOOR) * level;
        g.add(new THREE.Mesh(bottleLiquidGeometry(top), bottleLiquid()));
        // the open top of that solid, closed by the surface itself
        const surface = new THREE.Mesh(
          new THREE.CircleGeometry(bottleBore(top), 28), bottleSurface(),
        );
        surface.rotation.x = -Math.PI / 2;
        surface.position.y = top + 0.0003;
        g.add(surface);
      }

      // paper label — opaque, and it gives the body something to read against
      const label = cyl(0.0426, 0.0426, 0.072, bottleLabel(), 0, -0.048, 0, 28);
      g.add(label);

      const shell = new THREE.Mesh(
        new THREE.LatheGeometry(
          BOTTLE_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 28,
        ),
        bottleGlass(),
      );
      shell.renderOrder = 2; // after everything it is meant to be seen through
      g.add(shell);

      g.add(cyl(0.0215, 0.0215, 0.012, bottleCap(), 0, 0.146, 0, 28));
      break;
    }
    case 'knife': {
      const blade = box(0.2, 0.035, 0.004, steel(), 0.1, 0, 0);
      g.add(blade);
      g.add(box(0.1, 0.028, 0.02, wood(), -0.06, -0.004, 0));
      break;
    }
    case 'pipe': {
      const p = cyl(0.022, 0.022, 0.5, darkSteel());
      p.rotation.z = Math.PI / 2;
      g.add(p);
      const ring = cyl(0.028, 0.028, 0.03, steel(), 0.22, 0, 0);
      ring.rotation.z = Math.PI / 2;
      g.add(ring);
      break;
    }
    case 'pistol': {
      g.add(box(0.21, 0.045, 0.03, darkSteel(), 0.04, 0.03, 0));   // slide
      g.add(box(0.05, 0.13, 0.028, blackPlastic(), -0.04, -0.05, 0)); // grip
      g.add(box(0.07, 0.03, 0.026, blackPlastic(), 0.03, -0.02, 0)); // guard
      g.add(cyl(0.008, 0.008, 0.03, steel(), 0.15, 0.03, 0));
      break;
    }
    case 'flashlight': {
      const body = cyl(0.028, 0.028, 0.18, blackPlastic());
      body.rotation.z = Math.PI / 2;
      g.add(body);
      const head = cyl(0.04, 0.034, 0.06, darkSteel(), 0.11, 0, 0);
      head.rotation.z = Math.PI / 2;
      g.add(head);
      const lens = cyl(0.03, 0.03, 0.012, mat('lens', () => new THREE.MeshStandardMaterial({
        color: 0xfff7d0, emissive: 0xfff3b8, emissiveIntensity: 0.8,
      })), 0.145, 0, 0);
      lens.rotation.z = Math.PI / 2;
      g.add(lens);
      break;
    }
    case 'fuse': {
      const body = cyl(0.035, 0.035, 0.13, mat('ceramic', () => new THREE.MeshStandardMaterial({
        color: 0xd9cba6, roughness: 0.65,
      })));
      body.rotation.z = Math.PI / 2;
      g.add(body);
      for (const x of [-0.075, 0.075]) {
        const cap = cyl(0.038, 0.038, 0.03, brass(), x, 0, 0);
        cap.rotation.z = Math.PI / 2;
        g.add(cap);
      }
      g.add(box(0.05, 0.012, 0.012, mat('fuseWire', () => new THREE.MeshStandardMaterial({
        color: 0xffb347, emissive: 0xff8c1a, emissiveIntensity: 0.9,
      })), 0, 0.028, 0));
      break;
    }
    case 'battery': {
      g.add(cyl(0.021, 0.021, 0.11, mat('cell', () => new THREE.MeshStandardMaterial({
        color: 0x2f4f2a, roughness: 0.5, metalness: 0.4,
      }))));
      g.add(cyl(0.012, 0.012, 0.012, brass(), 0, 0.06, 0));
      break;
    }
    case 'detector': {
      g.add(box(0.13, 0.09, 0.05, mat('caseGrey', () => new THREE.MeshStandardMaterial({
        color: 0x5a5f52, roughness: 0.75,
      }))));
      g.add(box(0.075, 0.045, 0.008, mat('screen', () => new THREE.MeshStandardMaterial({
        color: 0x1b3a2a, emissive: 0x35d17a, emissiveIntensity: 0.7,
      })), 0, 0.012, 0.027));
      const ant = cyl(0.005, 0.005, 0.19, steel(), 0.05, 0.14, 0);
      ant.rotation.z = 0.15;
      g.add(ant);
      g.add(cyl(0.012, 0.012, 0.012, blackPlastic(), -0.04, -0.03, 0.027));
      break;
    }
    case 'ammo': {
      g.add(box(0.1, 0.06, 0.07, mat('ammoBox', () => new THREE.MeshStandardMaterial({ color: 0x4c5a37, roughness: 0.8 }))));
      g.add(box(0.1, 0.012, 0.07, brass(), 0, 0.037, 0));
      break;
    }
    default:
      g.add(box(0.1, 0.1, 0.1, darkSteel()));
  }
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return g;
}
