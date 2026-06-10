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
const glass = () => mat('glass', () => new THREE.MeshStandardMaterial({
  color: 0x3f6b35, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.55,
}));
const brass = () => mat('brass', () => new THREE.MeshStandardMaterial({ color: 0xb08d3c, roughness: 0.4, metalness: 0.85 }));

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

function cyl(rTop: number, rBot: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 12), m);
  mesh.position.set(x, y, z);
  return mesh;
}

/** Build the model for an item id. ~30–40 cm scale, centred at origin. */
export function buildItemMesh(id: string): THREE.Group {
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
      g.add(cyl(0.04, 0.04, 0.2, glass()));
      g.add(cyl(0.015, 0.03, 0.1, glass(), 0, 0.15, 0));
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
