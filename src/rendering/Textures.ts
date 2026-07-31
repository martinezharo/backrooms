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

/**
 * Scrawled graffiti decals for Level 0 walls. Transparent canvases: a hand
 * that shook, paint that ran, and a message nobody stayed around to explain.
 */
export type GraffitiLocale = 'en' | 'es';

interface GraffitiSpec {
  /** the same tag in every language we have it in; index is the variant id */
  lines: Record<GraffitiLocale, string[]>;
  color: string;
  size: number;
  /** tally marks scratched under the text — someone was counting days */
  tally?: number;
}

const GRAFFITI: GraffitiSpec[] = [
  { lines: { en: ['YOU ARE', 'NOT', 'ALONE'], es: ['NO', 'ESTÁS', 'SOLO'] }, color: '#7a1414', size: 52 },
  { lines: { en: ['KEEP', 'WALKING'], es: ['SIGUE', 'CAMINANDO'] }, color: '#1d1d1d', size: 50 },
  { lines: { en: ['THEY', "DON'T BLINK"], es: ['ELLOS NO', 'PARPADEAN'] }, color: '#5c1020', size: 46 },
  { lines: { en: ['THE EXIT', 'LIES'], es: ['LA SALIDA', 'MIENTE'] }, color: '#2b1a06', size: 48 },
  { lines: { en: ['DAY'], es: ['DÍA'] }, color: '#181818', size: 56, tally: 23 },
  { lines: { en: ["DON'T", 'LOOK BACK'], es: ['NO MIRES', 'ATRÁS'] }, color: '#6d1616', size: 48 },
  { lines: { en: ['I WAS NEW', 'HERE TOO'], es: ['YO TAMBIÉN', 'ERA NUEVO'] }, color: '#22200f', size: 42 },
  { lines: { en: ['TURN OFF', 'THE LIGHT'], es: ['APAGA', 'LA LUZ'] }, color: '#4a0f0f', size: 46 },
  { lines: { en: ['BE MY', 'CAPIBARA'], es: ['SÉ MI', 'CAPIBARA'] }, color: '#432a0c', size: 50 },
  {
    lines: {
      en: ['BE VERY', 'CAREFUL WITH', 'THE CAPYBARA'],
      es: ['MUCHO', 'CUIDADO CON', 'EL CAPIBARA'],
    },
    color: '#5c1020', size: 38,
  },
  { lines: { en: ['MEOW'], es: ['MIAU'] }, color: '#1d1d1d', size: 66 },
  { lines: { en: ['SEMPITERNA'], es: ['SEMPITERNA'] }, color: '#2b1a06', size: 52 },
];

let graffitiLocale: GraffitiLocale = 'en';

/**
 * Pick the language the walls are written in. Variant ids are shared across
 * locales, so world generation is untouched by the choice. Call before the
 * first chunk is built — it drops the cached decals so they are repainted.
 */
export function setGraffitiLocale(locale: GraffitiLocale): void {
  if (locale === graffitiLocale) return;
  graffitiLocale = locale;
  for (const m of graffitiCache ?? []) {
    m.map?.dispose();
    m.dispose();
  }
  graffitiCache = null;
}

/** Draw one line of text letter by letter, each nudged and tilted by hand. */
function scrawlLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  size: number,
  rng: () => number,
) {
  const font = (px: number) => `bold ${px}px "Trebuchet MS", Impact, sans-serif`;
  ctx.font = font(size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = [...text];
  const measure = () => chars.map((ch) => ctx.measureText(ch).width);
  // long words shrink to fit rather than running off the edge of the canvas
  let widths = measure();
  const budget = cx * 2 * 0.88;
  const raw = widths.reduce((a, b) => a + b, 0);
  if (raw > budget) {
    ctx.font = font(size * (budget / raw));
    widths = measure();
  }
  const total = widths.reduce((a, b) => a + b, 0);
  let x = cx - total / 2;
  for (let i = 0; i < chars.length; i++) {
    const w = widths[i];
    ctx.save();
    ctx.translate(x + w / 2, cy + (rng() - 0.5) * size * 0.18);
    ctx.rotate((rng() - 0.5) * 0.24);
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
    x += w;
  }
}

/** Paint that ran before it dried. */
function drips(ctx: CanvasRenderingContext2D, size: number, rng: () => number, color: string, count: number) {
  for (let i = 0; i < count; i++) {
    const x = size * (0.15 + rng() * 0.7);
    const y = size * (0.3 + rng() * 0.4);
    const len = size * (0.06 + rng() * 0.22);
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 1 + rng() * 2.5, len);
  }
}

/** Eat holes in the alpha channel so the paint reads as flaked and old. */
function erode(ctx: CanvasRenderingContext2D, size: number, rng: () => number) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    if (!d[i]) continue;
    d[i] = Math.max(0, Math.min(255, d[i] * (0.55 + rng() * 0.55)));
  }
  ctx.putImageData(img, 0, 0);
}

function graffitiCanvas(spec: GraffitiSpec, seed: number): HTMLCanvasElement {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(seed);
  ctx.fillStyle = spec.color;
  ctx.strokeStyle = spec.color;

  const lines = spec.lines[graffitiLocale] ?? spec.lines.en;
  const rows = lines.length + (spec.tally ? 1 : 0);
  const lineH = spec.size * 1.12;
  let y = size / 2 - ((rows - 1) * lineH) / 2;
  for (const line of lines) {
    scrawlLine(ctx, line, size / 2, y, spec.size, rng);
    y += lineH;
  }
  if (spec.tally) {
    // groups of five, the fifth struck through — and the last group unfinished
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    const groups = Math.ceil(spec.tally / 5);
    const gw = size * 0.7 / groups;
    for (let g = 0; g < groups; g++) {
      const n = Math.min(5, spec.tally - g * 5);
      const gx = size * 0.15 + g * gw;
      for (let m = 0; m < Math.min(n, 4); m++) {
        const mx = gx + m * (gw * 0.16);
        ctx.beginPath();
        ctx.moveTo(mx + (rng() - 0.5) * 3, y - 22);
        ctx.lineTo(mx + (rng() - 0.5) * 3, y + 22);
        ctx.stroke();
      }
      if (n === 5) {
        ctx.beginPath();
        ctx.moveTo(gx - 6, y + 16);
        ctx.lineTo(gx + gw * 0.16 * 3 + 8, y - 16);
        ctx.stroke();
      }
    }
  }

  drips(ctx, size, rng, spec.color, 7);
  erode(ctx, size, rng);
  return c;
}

function decalTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

let graffitiCache: THREE.MeshStandardMaterial[] | null = null;

/** Shared graffiti decal materials, one per phrase. */
export function getGraffitiMaterials(): THREE.MeshStandardMaterial[] {
  graffitiCache ??= GRAFFITI.map((spec, i) => new THREE.MeshStandardMaterial({
    map: decalTexture(graffitiCanvas(spec, 9001 + i * 17)),
    transparent: true,
    depthWrite: false,
    alphaTest: 0.02,
    roughness: 0.95,
    metalness: 0,
  }));
  return graffitiCache;
}

export const GRAFFITI_COUNT = GRAFFITI.length;

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
