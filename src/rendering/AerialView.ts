// The real world, seen from about a kilometre up: farmland, a river, roads and
// a small town, painted onto a canvas at runtime. Same rule as the rest of the
// game — no image files ship. Being procedural also means it holds detail all
// the way down, so the fall can keep zooming without turning into mush.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng';

const SIZE = 2048;

const FIELD_COLORS = [
  '#7d8b4a', '#8e9a52', '#6d7d3e', '#a3a35c', '#b9ad6a', '#94a05a',
  '#5f7038', '#c2b47a', '#7e8f4e', '#a8b063', '#6a7b42', '#8a7f4c',
];
const ROOF_COLORS = ['#8a6a55', '#7a5c4a', '#9c8674', '#6d6560', '#a2705a', '#565452'];

type Ctx = CanvasRenderingContext2D;

/** Irregular quad around a grid cell, so parcels never look like a chessboard. */
function parcel(rng: () => number, x: number, y: number, w: number, h: number): [number, number][] {
  const j = () => (rng() - 0.5) * Math.min(w, h) * 0.35;
  return [
    [x + j(), y + j()],
    [x + w + j(), y + j()],
    [x + w + j(), y + h + j()],
    [x + j(), y + h + j()],
  ];
}

function poly(ctx: Ctx, pts: [number, number][]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** Plough lines / crop rows inside a parcel — the giveaway that it's farmland. */
function ploughLines(ctx: Ctx, pts: [number, number][], angle: number, gap: number, alpha: number): void {
  ctx.save();
  poly(ctx, pts);
  ctx.clip();
  const cx = (pts[0][0] + pts[2][0]) / 2;
  const cy = (pts[0][1] + pts[2][1]) / 2;
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
  ctx.lineWidth = 1.1;
  for (let d = -400; d < 400; d += gap) {
    ctx.beginPath();
    ctx.moveTo(d, -400);
    ctx.lineTo(d, 400);
    ctx.stroke();
  }
  ctx.restore();
}

function river(ctx: Ctx, rng: () => number): void {
  const pts: [number, number][] = [];
  let y = rng() * SIZE;
  for (let x = -100; x <= SIZE + 100; x += 90) {
    y += (rng() - 0.5) * 190;
    y = Math.max(120, Math.min(SIZE - 120, y));
    pts.push([x, y]);
  }
  const stroke = (color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    ctx.stroke();
  };
  stroke('#6f7a4e', 44);   // damp banks
  stroke('#41576a', 30);
  stroke('#4d6a80', 20);
  stroke('rgba(190,215,230,0.25)', 7); // sun glint down the middle
}

function woods(ctx: Ctx, rng: () => number, cx: number, cy: number, r: number): void {
  const n = Math.floor(r * r * 0.035);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * r;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d * 0.8;
    const rr = 3.5 + rng() * 4.5;
    ctx.fillStyle = 'rgba(15,26,14,0.5)';
    ctx.beginPath();
    ctx.arc(x + rr * 0.5, y + rr * 0.6, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ['#2f4a24', '#375528', '#28401f', '#436030'][Math.floor(rng() * 4)];
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }
}

function road(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, width: number, dashed: boolean): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#4a4a48';
  ctx.lineWidth = width + 4;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = '#6b6b68';
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  if (dashed && width > 9) {
    ctx.strokeStyle = 'rgba(235,232,215,0.55)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([14, 18]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function building(ctx: Ctx, rng: () => number, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = 'rgba(10,12,16,0.42)';           // sun is north-west
  ctx.fillRect(x + w * 0.14 + 2, y + h * 0.16 + 2, w, h);
  ctx.fillStyle = ROOF_COLORS[Math.floor(rng() * ROOF_COLORS.length)];
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,246,220,0.16)';        // lit roof edge
  ctx.fillRect(x, y, w, Math.max(1, h * 0.18));
  if (w > 16 && h > 16 && rng() < 0.5) {           // roof ridge
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (w > h) { ctx.moveTo(x + 2, y + h / 2); ctx.lineTo(x + w - 2, y + h / 2); }
    else { ctx.moveTo(x + w / 2, y + 2); ctx.lineTo(x + w / 2, y + h - 2); }
    ctx.stroke();
  }
}

function town(ctx: Ctx, rng: () => number, cx: number, cy: number, radius: number): void {
  const blocks = 5 + Math.floor(rng() * 3);
  const step = (radius * 2) / blocks;
  const rot = (rng() - 0.5) * 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  // streets, each stopping short by a random amount so the town has no
  // suspiciously straight perimeter
  for (let i = 0; i <= blocks; i++) {
    const o = -radius + i * step;
    const r1 = radius * (0.72 + rng() * 0.3);
    const r2 = radius * (0.72 + rng() * 0.3);
    road(ctx, o, -r1, o, r2, 7, false);
    road(ctx, -r2, o, r1, o, 7, false);
  }
  // plots
  for (let bx = 0; bx < blocks; bx++) {
    for (let by = 0; by < blocks; by++) {
      const x0 = -radius + bx * step + 7;
      const y0 = -radius + by * step + 7;
      const inner = step - 14;
      if (inner < 12) continue;
      const kind = rng();
      if (kind < 0.12) {
        // a park / pitch — reads instantly as human scale
        ctx.fillStyle = '#5c7a3c';
        ctx.fillRect(x0, y0, inner, inner);
        if (rng() < 0.5) {
          ctx.strokeStyle = 'rgba(235,235,225,0.5)';
          ctx.lineWidth = 1.3;
          ctx.strokeRect(x0 + inner * 0.15, y0 + inner * 0.25, inner * 0.7, inner * 0.5);
        } else {
          woods(ctx, rng, x0 + inner / 2, y0 + inner / 2, inner * 0.4);
        }
        continue;
      }
      if (kind < 0.2) {
        // car park
        ctx.fillStyle = '#57575a';
        ctx.fillRect(x0, y0, inner, inner);
        for (let cnum = 0; cnum < inner / 5; cnum++) {
          ctx.fillStyle = ['#b8b4ac', '#3a4450', '#7a2b26', '#2c3630', '#9aa0a6'][Math.floor(rng() * 5)];
          ctx.fillRect(x0 + 3 + rng() * (inner - 9), y0 + 3 + rng() * (inner - 8), 3.4, 5.6);
        }
        continue;
      }
      const houses = 2 + Math.floor(rng() * 4);
      for (let hI = 0; hI < houses; hI++) {
        const w = inner * (0.28 + rng() * 0.34);
        const h = inner * (0.26 + rng() * 0.32);
        building(ctx, rng, x0 + rng() * (inner - w), y0 + rng() * (inner - h), w, h);
      }
    }
  }
  ctx.restore();
}

export interface Aerial {
  texture: THREE.CanvasTexture;
  /** where you're going to come down, in texture uv */
  landing: THREE.Vector2;
}

function paint(seed: number): { canvas: HTMLCanvasElement; landing: THREE.Vector2 } {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);

  // ---- farmland ----
  ctx.fillStyle = '#7a8749';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const grid = 9;
  const cell = SIZE / grid;
  for (let gy = -1; gy <= grid; gy++) {
    for (let gx = -1; gx <= grid; gx++) {
      const pts = parcel(rng, gx * cell, gy * cell, cell, cell);
      ctx.fillStyle = FIELD_COLORS[Math.floor(rng() * FIELD_COLORS.length)];
      poly(ctx, pts);
      ctx.fill();
      ploughLines(ctx, pts, rng() * Math.PI, 4 + rng() * 7, 0.05 + rng() * 0.07);
      // hedgerow shadow along two edges
      ctx.strokeStyle = 'rgba(28,38,20,0.35)';
      ctx.lineWidth = 2.2;
      poly(ctx, pts);
      ctx.stroke();
    }
  }

  // ---- woodland ----
  for (let i = 0; i < 7; i++) {
    woods(ctx, rng, rng() * SIZE, rng() * SIZE, 60 + rng() * 130);
  }

  river(ctx, rng);

  // ---- road network ----
  const jy = 300 + rng() * (SIZE - 600);
  const jx = 300 + rng() * (SIZE - 600);
  road(ctx, -50, jy - 180 + rng() * 60, SIZE + 50, jy + 140, 16, true);
  road(ctx, jx - 120, -50, jx + 90, SIZE + 50, 14, true);
  for (let i = 0; i < 5; i++) {
    road(ctx, rng() * SIZE, rng() * SIZE, rng() * SIZE, rng() * SIZE, 6, false);
  }
  // bridge where the main road meets the water
  ctx.fillStyle = '#7d7b73';
  ctx.fillRect(jx - 30, jy - 14, 60, 28);

  town(ctx, rng, jx, jy, 190 + rng() * 90);
  if (rng() < 0.7) town(ctx, rng, rng() * SIZE, rng() * SIZE, 90 + rng() * 60);

  // ---- lone farms scattered about ----
  for (let i = 0; i < 10; i++) {
    const fx = rng() * SIZE;
    const fy = rng() * SIZE;
    for (let b = 0; b < 2 + Math.floor(rng() * 3); b++) {
      building(ctx, rng, fx + rng() * 40, fy + rng() * 34, 12 + rng() * 22, 9 + rng() * 16);
    }
  }

  // ---- air between you and the ground ----
  const haze = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.1, SIZE / 2, SIZE / 2, SIZE * 0.72);
  haze.addColorStop(0, 'rgba(150,175,195,0)');
  haze.addColorStop(1, 'rgba(150,175,195,0.28)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // fine grain so flat colour never reads as a gradient
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 13;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  // Come down at the edge of the town: fields, roads and roofs all in frame,
  // which is what makes the last seconds legible instead of a green smear.
  // Canvas Y is flipped relative to texture V.
  const landing = new THREE.Vector2(
    (jx + (rng() - 0.5) * 160) / SIZE,
    1 - (jy + (rng() - 0.5) * 160) / SIZE,
  );

  return { canvas, landing };
}

let cached: { seed: number; aerial: Aerial } | null = null;

/** Top-down view of the world you left. Built once per seed, then reused. */
export function getAerial(seed: number): Aerial {
  if (cached && cached.seed === seed) return cached.aerial;
  const { canvas, landing } = paint(seed);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  cached = { seed, aerial: { texture, landing } };
  return cached.aerial;
}
