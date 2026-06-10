// All textures are generated at runtime on canvases — no asset files.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng';

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Sprinkle monochrome noise over the whole canvas. */
function grain(ctx: CanvasRenderingContext2D, size: number, rng: () => number, amount: number, alpha: number) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * alpha));
  }
  ctx.putImageData(img, 0, 0);
}

function stains(ctx: CanvasRenderingContext2D, size: number, rng: () => number, count: number, color: string, maxR: number) {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = (0.3 + rng() * 0.7) * maxR;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

/** Classic Level 0 wallpaper: two-tone yellow stripes, grime, baseboard at the bottom. */
function wallpaper(): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(101);

  ctx.fillStyle = '#b3a04f';
  ctx.fillRect(0, 0, size, size);
  // vertical stripe pattern
  for (let x = 0; x < size; x += 32) {
    ctx.fillStyle = x % 64 === 0 ? '#ab984a' : '#b8a553';
    ctx.fillRect(x, 0, 32, size);
    ctx.fillStyle = 'rgba(140,120,50,0.35)';
    ctx.fillRect(x, 0, 2, size);
  }
  // subtle damask-ish dots
  ctx.fillStyle = 'rgba(125,108,46,0.4)';
  for (let y = 16; y < size; y += 42) {
    for (let x = 16; x < size; x += 32) {
      ctx.beginPath();
      ctx.arc(x + ((y / 42) % 2) * 16, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  stains(ctx, size, rng, 14, 'rgba(70,58,20,0.18)', 90);
  stains(ctx, size, rng, 5, 'rgba(40,32,10,0.22)', 130);
  grain(ctx, size, rng, 26, 0.8);

  // baseboard strip (bottom of the texture = bottom of the wall)
  const bb = Math.floor(size * 0.055);
  ctx.fillStyle = '#5e5430';
  ctx.fillRect(0, size - bb, size, bb);
  ctx.fillStyle = 'rgba(255,240,180,0.16)';
  ctx.fillRect(0, size - bb, size, 3);
  return c;
}

/** Damp mustard carpet. */
function carpet(): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(202);
  ctx.fillStyle = '#8a7a3e';
  ctx.fillRect(0, 0, size, size);
  // fiber speckle
  for (let i = 0; i < 26000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const v = rng();
    ctx.fillStyle = v < 0.5 ? 'rgba(60,52,24,0.5)' : 'rgba(168,150,80,0.4)';
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  stains(ctx, size, rng, 10, 'rgba(45,38,16,0.30)', 110); // damp patches
  stains(ctx, size, rng, 6, 'rgba(30,26,12,0.35)', 60);
  grain(ctx, size, rng, 18, 0.8);
  return c;
}

/** Suspended-ceiling tiles with grid. */
function ceilingTiles(): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(303);
  ctx.fillStyle = '#b0a888';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(90,84,60,${0.12 + rng() * 0.2})`;
    ctx.fillRect(rng() * size, rng() * size, 2, 2);
  }
  // tile grid
  ctx.strokeStyle = 'rgba(70,64,44,0.85)';
  ctx.lineWidth = 4;
  for (let p = 0; p <= size; p += 128) {
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  stains(ctx, size, rng, 8, 'rgba(95,75,30,0.3)', 100); // water damage
  grain(ctx, size, rng, 14, 0.8);
  return c;
}

/** Raw concrete for Level 2. */
function concrete(): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(404);
  ctx.fillStyle = '#6e6a62';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 18000; i++) {
    const v = 90 + rng() * 50;
    ctx.fillStyle = `rgba(${v},${v},${v - 6},${0.18 + rng() * 0.2})`;
    ctx.fillRect(rng() * size, rng() * size, 2.5, 2.5);
  }
  // cracks
  ctx.strokeStyle = 'rgba(38,36,32,0.5)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 9; i++) {
    let x = rng() * size;
    let y = rng() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (rng() - 0.5) * 70;
      y += rng() * 45;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  stains(ctx, size, rng, 12, 'rgba(30,30,28,0.3)', 120);
  stains(ctx, size, rng, 6, 'rgba(50,42,20,0.25)', 70); // rust runs
  grain(ctx, size, rng, 22, 1);
  return c;
}

/** Pool tiles — small squares, grout, grime. Tinted per use (wall/floor). */
function poolTile(base: string, alt: string): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(505);
  const t = 32; // tile pixel size
  for (let y = 0; y < size; y += t) {
    for (let x = 0; x < size; x += t) {
      ctx.fillStyle = rng() < 0.93 ? base : alt;
      ctx.fillRect(x, y, t, t);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x + 2, y + 2, t - 4, 3);
    }
  }
  ctx.strokeStyle = 'rgba(60,72,68,0.9)';
  ctx.lineWidth = 2.5;
  for (let p = 0; p <= size; p += t) {
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  stains(ctx, size, rng, 12, 'rgba(40,70,55,0.30)', 110); // algae grime
  stains(ctx, size, rng, 6, 'rgba(20,30,26,0.3)', 60);
  grain(ctx, size, rng, 12, 0.8);
  return c;
}

/** Dark scuffed metal for pipes/props. */
function metal(): HTMLCanvasElement {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(606);
  ctx.fillStyle = '#4a4a4e';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5000; i++) {
    const v = 55 + rng() * 50;
    ctx.fillStyle = `rgba(${v},${v},${v + 4},0.3)`;
    ctx.fillRect(rng() * size, rng() * size, 3, 1);
  }
  stains(ctx, size, rng, 8, 'rgba(95,55,25,0.35)', 50); // rust
  grain(ctx, size, rng, 20, 1);
  return c;
}

export interface WorldMaterials {
  wall: THREE.MeshStandardMaterial;        // L0 wallpaper
  carpet: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;    // L2 walls/floors/ceiling
  tileWall: THREE.MeshStandardMaterial;    // L37/L7 walls
  tileFloor: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  fixtureOn: THREE.MeshStandardMaterial;   // glowing lamp panel
  fixtureOff: THREE.MeshStandardMaterial;
  fixtureFrame: THREE.MeshStandardMaterial;
}

let cached: WorldMaterials | null = null;

export function getWorldMaterials(): WorldMaterials {
  if (cached) return cached;

  const wallTex = toTexture(wallpaper());
  const carpetTex = toTexture(carpet(), 1, 1);
  const ceilTex = toTexture(ceilingTiles());
  const concTex = toTexture(concrete());
  const tileWallTex = toTexture(poolTile('#b9cfc6', '#7fa89b'));
  const tileFloorTex = toTexture(poolTile('#a8c4ba', '#6e9a8c'));
  const metalTex = toTexture(metal());

  cached = {
    wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.93, metalness: 0 }),
    carpet: new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 1.0, metalness: 0 }),
    ceiling: new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.95, metalness: 0 }),
    concrete: new THREE.MeshStandardMaterial({ map: concTex, roughness: 0.97, metalness: 0 }),
    tileWall: new THREE.MeshStandardMaterial({ map: tileWallTex, roughness: 0.35, metalness: 0.05 }),
    tileFloor: new THREE.MeshStandardMaterial({ map: tileFloorTex, roughness: 0.3, metalness: 0.05 }),
    metal: new THREE.MeshStandardMaterial({ map: metalTex, roughness: 0.55, metalness: 0.7 }),
    fixtureOn: new THREE.MeshStandardMaterial({
      color: 0x202018,
      emissive: 0xfff4cf,
      emissiveIntensity: 1.5,
      roughness: 0.6,
    }),
    fixtureOff: new THREE.MeshStandardMaterial({ color: 0x3a382e, roughness: 0.8 }),
    fixtureFrame: new THREE.MeshStandardMaterial({ color: 0x55503c, roughness: 0.7, metalness: 0.3 }),
  };
  return cached;
}
