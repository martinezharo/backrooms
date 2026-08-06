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

/**
 * Blotches, drawn nine times across the wrap offsets so a blob that runs off
 * one edge comes back in on the other. Without this every stain is chopped at
 * the canvas border and the repeat reads as a visible grid on floors.
 */
function stains(ctx: CanvasRenderingContext2D, size: number, rng: () => number, count: number, color: string, maxR: number) {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = (0.3 + rng() * 0.7) * maxR;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const bx = x + ox * size;
        const by = y + oy * size;
        if (bx + r < 0 || bx - r > size || by + r < 0 || by - r > size) continue;
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, r);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(bx - r, by - r, r * 2, r * 2);
      }
    }
  }
  ctx.restore();
}

/** Classic Level 0 wallpaper: two-tone yellow stripes, grime, baseboard at the bottom. */
function wallpaper(): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(101);

  ctx.fillStyle = '#cabd78';
  ctx.fillRect(0, 0, size, size);
  // barely-there vertical stripes: the pattern should only surface up close
  for (let x = 0; x < size; x += 32) {
    ctx.fillStyle = x % 64 === 0 ? '#c8bb77' : '#ccbf7b';
    ctx.fillRect(x, 0, 32, size);
    ctx.fillStyle = 'rgba(175,160,100,0.14)';
    ctx.fillRect(x, 0, 2, size);
  }
  // subtle damask-ish dots
  ctx.fillStyle = 'rgba(182,167,104,0.35)';
  for (let y = 16; y < size; y += 42) {
    for (let x = 16; x < size; x += 32) {
      ctx.beginPath();
      ctx.arc(x + ((y / 42) % 2) * 16, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // grime stays faint — flat, evenly lit walls are what makes the space wrong
  stains(ctx, size, rng, 9, 'rgba(120,105,55,0.10)', 90);
  stains(ctx, size, rng, 4, 'rgba(95,82,40,0.12)', 130);
  grain(ctx, size, rng, 12, 0.8);

  // baseboard strip (bottom of the texture = bottom of the wall)
  const bb = Math.floor(size * 0.05);
  ctx.fillStyle = '#a89a5e';
  ctx.fillRect(0, size - bb, size, bb);
  ctx.fillStyle = 'rgba(255,248,210,0.22)';
  ctx.fillRect(0, size - bb, size, 3);
  return c;
}

/** Damp mustard carpet. */
function carpet(): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(202);
  ctx.fillStyle = '#95895f';
  ctx.fillRect(0, 0, size, size);
  // fiber speckle
  for (let i = 0; i < 26000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const v = rng();
    ctx.fillStyle = v < 0.5 ? 'rgba(112,101,68,0.45)' : 'rgba(176,164,124,0.38)';
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  stains(ctx, size, rng, 8, 'rgba(112,100,64,0.18)', 110); // damp patches
  stains(ctx, size, rng, 5, 'rgba(90,80,50,0.20)', 60);
  grain(ctx, size, rng, 12, 0.8);
  return c;
}

/** Suspended-ceiling tiles with grid. */
function ceilingTiles(): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(303);
  ctx.fillStyle = '#d5d0b6';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(160,154,128,${0.12 + rng() * 0.18})`;
    ctx.fillRect(rng() * size, rng() * size, 2, 2);
  }
  // tile grid
  ctx.strokeStyle = 'rgba(150,144,118,0.75)';
  ctx.lineWidth = 4;
  for (let p = 0; p <= size; p += 128) {
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  stains(ctx, size, rng, 6, 'rgba(150,125,65,0.16)', 100); // water damage
  grain(ctx, size, rng, 9, 0.8);
  return c;
}

/**
 * Poured concrete for Level 2 — warm damp grey with the horizontal seams the
 * formwork left behind, water running down from every joint.
 */
function concrete(): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(404);
  ctx.fillStyle = '#7b746a';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 18000; i++) {
    const v = 105 + rng() * 45;
    ctx.fillStyle = `rgba(${v},${v - 4},${v - 12},${0.16 + rng() * 0.18})`;
    ctx.fillRect(rng() * size, rng() * size, 2.5, 2.5);
  }
  // form-board seams: the wall was poured in lifts and every lift shows
  for (let y = 0; y < size; y += 128) {
    ctx.fillStyle = 'rgba(52,48,42,0.42)';
    ctx.fillRect(0, y, size, 2);
    ctx.fillStyle = 'rgba(150,144,132,0.20)';
    ctx.fillRect(0, y + 2, size, 2);
    // tie-rod holes punched along the seam
    for (let x = 24 + (rng() * 40 | 0); x < size; x += 96 + rng() * 40) {
      ctx.fillStyle = 'rgba(46,42,36,0.55)';
      ctx.beginPath();
      ctx.arc(x, y + 12, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // damp running down from the seams — vertical, always downward
  for (let i = 0; i < 26; i++) {
    const x = rng() * size;
    const y0 = (rng() * 4 | 0) * 128;
    const len = 40 + rng() * 150;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, 'rgba(48,44,36,0.30)');
    g.addColorStop(1, 'rgba(48,44,36,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, 3 + rng() * 12, len);
  }
  // cracks
  ctx.strokeStyle = 'rgba(48,44,38,0.45)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 7; i++) {
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
  stains(ctx, size, rng, 10, 'rgba(40,38,32,0.26)', 120);
  stains(ctx, size, rng, 7, 'rgba(96,62,26,0.22)', 70); // rust bleeding out of the rebar
  grain(ctx, size, rng, 20, 1);
  return c;
}

/**
 * Square tiles — grout, a highlight along the top edge, and grime that pools
 * in the joints. `grime` tints the dirt: pale for the poolrooms, black-green
 * for what is under the flood.
 */
function poolTile(base: string, alt: string, grout: string, grime: string, grimeAmount: number): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(505);
  const t = 64; // 8 tiles across the map — 25 cm squares at one repeat per cell.
  // Finer than that and the grid aliases into rainbow moiré at grazing angles.
  for (let y = 0; y < size; y += t) {
    for (let x = 0; x < size; x += t) {
      ctx.fillStyle = rng() < 0.9 ? base : alt;
      ctx.fillRect(x, y, t, t);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x + 3, y + 3, t - 6, 4);
    }
  }
  ctx.strokeStyle = grout;
  ctx.lineWidth = 3.5;
  for (let p = 0; p <= size; p += t) {
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  stains(ctx, size, rng, grimeAmount, grime, 110);
  grain(ctx, size, rng, 10, 0.8);
  return c;
}

/**
 * The slab of a car park: worn asphalt with the aggregate coming through,
 * tyre polish down the aisles and something that dripped out of an engine
 * bay and stayed.
 */
function asphalt(): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(707);
  ctx.fillStyle = '#3b3d3c';
  ctx.fillRect(0, 0, size, size);
  // aggregate: chips of stone at every size, most of them dark
  for (let i = 0; i < 14000; i++) {
    const v = 40 + rng() * 70;
    const s = 1 + rng() * 3;
    ctx.fillStyle = `rgba(${v},${v + 2},${v},${0.25 + rng() * 0.4})`;
    ctx.fillRect(rng() * size, rng() * size, s, s);
  }
  // patches where the surface was cut open and put back
  for (let i = 0; i < 5; i++) {
    const w = 60 + rng() * 160;
    const h = 60 + rng() * 160;
    ctx.fillStyle = `rgba(30,31,30,${0.14 + rng() * 0.12})`;
    ctx.fillRect(rng() * size, rng() * size, w, h);
  }
  // cracks, filled with tar that has gone shiny
  ctx.lineWidth = 2.6;
  for (let i = 0; i < 9; i++) {
    let x = rng() * size;
    let y = rng() * size;
    ctx.strokeStyle = `rgba(20,20,19,${0.4 + rng() * 0.3})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 9; s++) {
      x += (rng() - 0.5) * 90;
      y += (rng() - 0.5) * 90;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  stains(ctx, size, rng, 7, 'rgba(16,16,15,0.35)', 90);   // oil
  stains(ctx, size, rng, 5, 'rgba(96,88,70,0.16)', 120);  // dust
  grain(ctx, size, rng, 18, 1);
  return c;
}

/**
 * Painted block wall — the cream-over-breezeblock every underground car park
 * in the world has, with the bottom metre gone grey from wheel spray.
 */
function paintedBlock(): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(808);
  ctx.fillStyle = '#a8a496';
  ctx.fillRect(0, 0, size, size);
  // block courses, offset every other row
  const bw = 128, bh = 64;
  for (let y = 0, row = 0; y < size; y += bh, row++) {
    for (let x = -bw; x < size + bw; x += bw) {
      const ox = x + (row % 2 ? bw / 2 : 0);
      const v = 158 + rng() * 22;
      ctx.fillStyle = `rgb(${v},${v - 4},${v - 16})`;
      ctx.fillRect(ox + 2, y + 2, bw - 4, bh - 4);
    }
    ctx.fillStyle = 'rgba(120,116,104,0.5)';
    ctx.fillRect(0, y, size, 3);
  }
  ctx.fillStyle = 'rgba(120,116,104,0.35)';
  for (let y = 0, row = 0; y < size; y += bh, row++) {
    for (let x = -bw; x < size + bw; x += bw) {
      ctx.fillRect(x + (row % 2 ? bw / 2 : 0), y, 3, bh);
    }
  }
  // wheel spray up the bottom of the wall
  const g = ctx.createLinearGradient(0, size, 0, size * 0.72);
  g.addColorStop(0, 'rgba(52,50,45,0.55)');
  g.addColorStop(1, 'rgba(52,50,45,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, size * 0.72, size, size * 0.28);
  stains(ctx, size, rng, 8, 'rgba(70,66,54,0.18)', 110);
  stains(ctx, size, rng, 4, 'rgba(96,62,26,0.2)', 60); // rust off the rebar
  grain(ctx, size, rng, 16, 0.9);
  return c;
}

/**
 * A continuous wobble in roughly [-1,1]. A handful of sines with random phases
 * gives an outline that is ragged at every scale and never repeats — a torn
 * edge stays torn whether you see it across the room or with your nose on it,
 * which a four-point polygon can never do.
 */
function wobbler(rng: () => number, octaves: number): (t: number) => number {
  const waves: [number, number, number][] = [];
  let norm = 0;
  for (let k = 0; k < octaves; k++) {
    // the fine detail falls away faster than linearly, or the outline reads as
    // machine zigzag rather than something that gave way
    const amp = 1 / Math.pow(k + 1.25, 1.45);
    waves.push([(1.6 + k * 2.9) * (0.7 + rng() * 0.8), rng() * Math.PI * 2, amp]);
    norm += amp;
  }
  return (t) => {
    let v = 0;
    for (const [f, p, amp] of waves) v += amp * Math.sin(t * f * Math.PI * 2 + p);
    return v / norm;
  };
}

/** A strip of wallpaper that let go at a seam and came away from the wall. */
interface Peel {
  /** x of the joint between two drops of paper — where it always starts */
  seam: number;
  /** which side of the seam the paper pulled away from */
  dir: 1 | -1;
  top: number;
  height: number;
  /** how far the missing paper reaches out from the seam */
  width: number;
  /** how much of the strip is still hanging there, folded back; 0 = long gone */
  flap: number;
}

/**
 * Outline of a peeled strip. Paper lets go the way gravity pulls it: a hairline
 * at the top where it first lifted, widening as it comes down, and a wide
 * ragged mouth at the bottom where the strip finally tore across and stopped.
 *
 * `side` scales it across the seam — negative reflects the same tear back over
 * the wall for the hanging strip, foreshortened by how far it has folded — and
 * `sag` drops that strip below the hole it came out of, because a metre of wet
 * paper does not hold its own shape.
 */
function peelPath(
  p: Peel,
  wob: (t: number) => number,
  edge: (t: number) => number,
  side: number,
  sag: number,
): Path2D {
  const path = new Path2D();
  const steps = 56;
  const sign = Math.sign(side) * p.dir;
  const at = (t: number) => p.top + p.height * (t * (1 + sag * 0.35) + sag * 0.12);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // a hairline at the lift, widening all the way down
    const w = p.width * Math.abs(side)
      * Math.max(0, Math.pow(t, 0.32) * (1 + 0.3 * wob(t)) + 0.05 * edge(t));
    const x = p.seam + sign * w;
    if (i === 0) path.moveTo(x, at(t)); else path.lineTo(x, at(t));
  }
  // across the bottom: where the strip tore through and came off in one go
  const mouth = p.width * Math.abs(side) * (1 + 0.34 * wob(1));
  for (let i = 8; i >= 0; i--) {
    const u = i / 8;
    path.lineTo(p.seam + sign * mouth * u, at(1) + edge(u * 0.5 + 1.5) * 5);
  }
  // and back up the seam, which split near enough straight
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    path.lineTo(p.seam + p.dir * edge(t) * 3.5, at(t));
  }
  path.closePath();
  return path;
}

/** Soft blotches confined to whatever is already clipped. */
function mottle(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  x0: number, y0: number, w: number, h: number,
  count: number, color: string, maxR: number,
) {
  for (let i = 0; i < count; i++) {
    const x = x0 + rng() * w;
    const y = y0 + rng() * h;
    const r = (0.35 + rng() * 0.65) * maxR;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/**
 * One peel, in the order light would build it: the plaster behind, the shadow
 * the overhanging paper drops into the hole, the torn paper core around the
 * rim, and last the strip itself folded back with its dry glue side up.
 */
function drawPeel(ctx: CanvasRenderingContext2D, p: Peel, rng: () => number): void {
  const wob = wobbler(rng, 6);
  const edge = wobbler(rng, 4);
  const patch = peelPath(p, wob, edge, 1, 0);
  const x0 = p.seam - p.width * 1.4;
  const bw = p.width * 2.8;

  // --- the wall behind it: skim plaster nobody ever painted
  ctx.save();
  ctx.clip(patch);
  const base = ctx.createLinearGradient(0, p.top, 0, p.top + p.height);
  base.addColorStop(0, '#a9a290');
  base.addColorStop(0.5, '#9c9583');
  base.addColorStop(1, '#837c68');
  ctx.fillStyle = base;
  ctx.fillRect(x0, p.top - 20, bw, p.height + 60);
  // paper that would not come off, and the glue that held it
  mottle(ctx, rng, x0, p.top, bw, p.height, 18, 'rgba(206,198,172,0.22)', 26);
  mottle(ctx, rng, x0, p.top, bw, p.height, 10, 'rgba(60,52,34,0.22)', 34);
  // damp rising into the plaster from the bottom
  const damp = ctx.createLinearGradient(0, p.top + p.height, 0, p.top + p.height * 0.55);
  damp.addColorStop(0, 'rgba(40,34,20,0.42)');
  damp.addColorStop(1, 'rgba(40,34,20,0)');
  ctx.fillStyle = damp;
  ctx.fillRect(x0, p.top, bw, p.height + 40);
  // the paper stands proud of the tear, so a narrow shadow runs along the rim —
  // a few millimetres of it, not half the hole
  const ao = ctx.createLinearGradient(p.seam, 0, p.seam + p.dir * 14, 0);
  ao.addColorStop(0, 'rgba(18,14,8,0.5)');
  ao.addColorStop(1, 'rgba(18,14,8,0)');
  ctx.fillStyle = ao;
  ctx.fillRect(x0, p.top - 20, bw, p.height + 60);
  // the same, all the way round the rim, laid on in two softening passes
  ctx.strokeStyle = 'rgba(18,14,8,0.3)';
  ctx.lineWidth = 11;
  ctx.stroke(patch);
  ctx.strokeStyle = 'rgba(18,14,8,0.28)';
  ctx.lineWidth = 4;
  ctx.stroke(patch);
  ctx.restore();

  // --- the cut edge: a hair of pale paper core all the way round the hole
  ctx.save();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(222,212,178,0.28)';
  ctx.stroke(patch);
  ctx.restore();

  if (p.flap < 0.06) return;

  // --- the strip itself, folded back over the wall it used to cover
  const flap = peelPath(p, wob, edge, -p.flap, 0.32);
  ctx.save();
  ctx.shadowColor = 'rgba(10,8,4,0.6)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetX = -p.dir * 5;
  ctx.shadowOffsetY = 9;
  const backing = ctx.createLinearGradient(
    p.seam, 0, p.seam - p.dir * p.width * p.flap, 0,
  );
  backing.addColorStop(0, '#453f30');    // the crease, where no light gets in
  backing.addColorStop(0.22, '#726b55');
  backing.addColorStop(0.72, '#867e66'); // backing paper, out of the light for years
  backing.addColorStop(1, '#6a634f');
  ctx.fillStyle = backing;
  ctx.fill(flap);
  ctx.restore();

  ctx.save();
  ctx.clip(flap);
  const fx = p.seam - (p.dir > 0 ? p.width * p.flap : 0);
  mottle(ctx, rng, fx, p.top, p.width * p.flap, p.height, 14, 'rgba(206,196,166,0.2)', 22);
  mottle(ctx, rng, fx, p.top, p.width * p.flap, p.height, 8, 'rgba(46,38,22,0.22)', 26);
  ctx.restore();

  // the fold catches the strip light along its whole length
  ctx.save();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = 'rgba(208,198,164,0.35)';
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    // along the flap, not the hole — the folded strip hangs lower than it
    const y = p.top + p.height * (t * 1.11 + 0.038);
    const x = p.seam + p.dir * (edge(t) * 3.5 - 1.5);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * The last floor's take on the lobby: the same pattern with the warmth pulled
 * out of it, coming off the wall in strips. Four seeds' worth get built and
 * handed out per wall segment — one canvas stretched over every panel turned
 * the tears into a sticker you saw a hundred times a corridor.
 */
function rottenWallpaper(seed: number): HTMLCanvasElement {
  const c = wallpaper();
  const size = c.width;
  const ctx = c.getContext('2d')!;
  const rng = mulberry32(seed);

  // drain the yellow
  ctx.fillStyle = 'rgba(38,34,20,0.42)';
  ctx.fillRect(0, 0, size, size);

  // Paper hangs in drops about half a metre wide and every failure starts at a
  // join. The width is near enough fixed, but where the run of paper *began* is
  // not — so each sheet gets its own phase, and the tears stop lining up at the
  // same two places on every panel in the corridor.
  const dropW = size * (0.3 + rng() * 0.14);
  const seams: number[] = [];
  for (let sx = rng() * dropW; sx < size; sx += dropW) {
    if (sx > size * 0.08 && sx < size * 0.92) seams.push(sx);
  }
  if (!seams.length) seams.push(size * (0.3 + rng() * 0.4));

  // joins that have opened up on their own — a dark line with the lifted lip
  // of the overlapping drop catching light beside it
  for (const sx of seams) {
    const y0 = rng() * size * 0.3;
    const y1 = size * (0.75 + rng() * 0.25);
    const jitter = wobbler(rng, 3);
    ctx.save();
    ctx.lineWidth = 1.4;
    for (const [off, color] of [[0, 'rgba(28,22,10,0.5)'], [1.6, 'rgba(214,204,168,0.16)']] as const) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let i = 0; i <= 30; i++) {
        const t = i / 30;
        const y = y0 + (y1 - y0) * t;
        const x = sx + off + jitter(t) * 1.8;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // blisters: damp got behind the paper and it never lay flat again
  for (let i = 0; i < 5; i++) {
    const x = size * (0.1 + rng() * 0.8);
    const y = size * (0.1 + rng() * 0.75);
    const r = 26 + rng() * 50;
    ctx.save();
    ctx.translate(0, y);
    ctx.scale(1, 0.6);   // round on the wall, not on the canvas
    ctx.translate(0, -y);
    const lit = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, 0, x - r * 0.3, y - r * 0.35, r);
    lit.addColorStop(0, 'rgba(226,214,172,0.16)');
    lit.addColorStop(1, 'rgba(226,214,172,0)');
    ctx.fillStyle = lit;
    ctx.fillRect(x - r * 1.4, y - r * 1.4, r * 2.8, r * 2.8);
    const dark = ctx.createRadialGradient(x + r * 0.3, y + r * 0.4, 0, x + r * 0.3, y + r * 0.4, r * 0.9);
    dark.addColorStop(0, 'rgba(26,20,10,0.2)');
    dark.addColorStop(1, 'rgba(26,20,10,0)');
    ctx.fillStyle = dark;
    ctx.fillRect(x - r * 1.4, y - r * 1.4, r * 2.8, r * 2.8);
    ctx.restore();
  }

  // One big peel, sometimes a second, always hanging off a seam and always
  // clear of the baseboard — the paper gives up in the middle of the wall.
  // The canvas is stretched over a face 2 m across and 3.45 m tall, so anything
  // drawn square comes out as a spike on the wall: every shape here is laid out
  // wide, to arrive at the proportions it actually wants.
  // Most sheets are merely old. A wall where every panel has lost paper stops
  // being a lobby that is failing and starts being a ruin, which is the wrong
  // kind of frightening.
  const roll = rng();
  const count = roll < 0.2 ? 0 : roll < 0.75 ? 1 : 2;
  for (let i = 0; i < count; i++) {
    // A nick the size of a hand and a strip half the wall are the same failure
    // at different ages; drawing them all one size is what made the last floor
    // look wallpapered in a repeating pattern of holes.
    const scale = Math.pow(rng(), 1.35);          // small ones are commonplace
    const width = size * (0.05 + scale * 0.26);
    const height = size * (0.07 + scale * 0.33) * (0.75 + rng() * 0.5);
    const top = size * (0.03 + rng() * (0.86 - height / size));
    drawPeel(ctx, {
      seam: seams[Math.floor(rng() * seams.length)],
      dir: rng() < 0.5 ? 1 : -1,
      top,
      height,
      width,
      // folded back on itself, so it covers much less wall than the hole it
      // left; now and then the strip is simply gone
      flap: rng() < 0.25 ? 0 : 0.3 + rng() * 0.28,
    }, rng);
  }

  // small corner curls at the top, where the paper dries out first
  for (let i = 0; i < 2; i++) {
    const x = size * (0.08 + rng() * 0.84);
    const w = 16 + rng() * 26;
    const h = 10 + rng() * 18;
    ctx.save();
    ctx.shadowColor = 'rgba(10,8,4,0.5)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = 'rgba(150,142,116,0.8)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.quadraticCurveTo(x + w * 0.7, h * 0.4, x + w * 0.2, h);
    ctx.lineTo(x - w * 0.6, h * 0.75);
    ctx.quadraticCurveTo(x - w * 0.5, h * 0.2, x, 0);
    ctx.fill();
    ctx.restore();
  }

  // hairline splits, too fine to see until you are close
  ctx.strokeStyle = 'rgba(30,24,12,0.28)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    const x = rng() * size;
    const y = rng() * size * 0.9;
    const len = 12 + rng() * 40;
    const lean = (rng() - 0.5) * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + lean * len, y + len);
    ctx.stroke();
  }

  stains(ctx, size, rng, 12, 'rgba(30,22,8,0.3)', 140);
  stains(ctx, size, rng, 6, 'rgba(58,16,10,0.18)', 90);
  grain(ctx, size, rng, 26, 1);
  return c;
}

/**
 * Every sheet of rotten wallpaper on one canvas, laid out in a grid. A wall
 * segment is given a cell to read from, which is what stops the corridor being
 * the same tear over and over — and because they all live in one map, the whole
 * floor still merges into a single draw call per chunk. Twelve of them, hung
 * either way round, is 24 walls before anything visibly comes back.
 */
export const ROT_WALL_COLS = 4;
export const ROT_WALL_ROWS = 3;
export const ROT_WALL_SHEETS = ROT_WALL_COLS * ROT_WALL_ROWS;

function rottenWallpaperAtlas(): HTMLCanvasElement {
  const cell = 512;
  const c = document.createElement('canvas');
  c.width = ROT_WALL_COLS * cell;
  c.height = ROT_WALL_ROWS * cell;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < ROT_WALL_SHEETS; i++) {
    ctx.drawImage(
      rottenWallpaper(909 + i * 977),
      (i % ROT_WALL_COLS) * cell,
      Math.floor(i / ROT_WALL_COLS) * cell,
    );
  }
  return c;
}

function rottenCarpet(): HTMLCanvasElement {
  const c = carpet();
  const size = c.width;
  const ctx = c.getContext('2d')!;
  const rng = mulberry32(1010);
  ctx.fillStyle = 'rgba(24,22,12,0.5)';
  ctx.fillRect(0, 0, size, size);
  stains(ctx, size, rng, 14, 'rgba(18,20,12,0.36)', 150); // it never dried
  stains(ctx, size, rng, 6, 'rgba(70,52,20,0.24)', 80);
  grain(ctx, size, rng, 24, 1);
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
  { lines: { en: ['BE MY', 'CAPYBARA'], es: ['SÉ MI', 'CAPYBARA'] }, color: '#432a0c', size: 50 },
  {
    lines: {
      en: ['BE VERY', 'CAREFUL WITH', 'THE CAPYBARA'],
      es: ['MUCHO', 'CUIDADO CON', 'EL CAPYBARA'],
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

const codeCache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * The four digits somebody sprayed next to the stairwell door on Level 2,
 * with an arrow, because they knew exactly how much good it would do them.
 */
export function getCodeMaterial(code: string): THREE.MeshStandardMaterial {
  const hit = codeCache.get(code);
  if (hit) return hit;
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(4242);
  const red = '#7d1512';
  ctx.fillStyle = red;
  ctx.strokeStyle = red;
  scrawlLine(ctx, graffitiLocale === 'es' ? 'LA PUERTA' : 'THE DOOR', size / 2, 52, 34, rng);
  scrawlLine(ctx, code, size / 2, 128, 82, rng);
  // an arrow pointing down at nothing in particular
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(size / 2, 172);
  ctx.lineTo(size / 2 + 6, 226);
  ctx.moveTo(size / 2 - 22, 200);
  ctx.lineTo(size / 2 + 6, 228);
  ctx.moveTo(size / 2 + 30, 198);
  ctx.lineTo(size / 2 + 6, 228);
  ctx.stroke();
  drips(ctx, size, rng, red, 9);
  erode(ctx, size, rng);
  const mat = new THREE.MeshStandardMaterial({
    map: decalTexture(c),
    transparent: true,
    depthWrite: false,
    alphaTest: 0.02,
    roughness: 0.95,
    metalness: 0,
  });
  codeCache.set(code, mat);
  return mat;
}

export interface WorldMaterials {
  wall: THREE.MeshStandardMaterial;        // L0 wallpaper
  carpet: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;    // L2 walls/floors/ceiling
  tileWall: THREE.MeshStandardMaterial;    // L37 poolroom walls
  tileFloor: THREE.MeshStandardMaterial;   // L37 poolroom floors + basins
  deepTile: THREE.MeshStandardMaterial;    // L7, the same tile gone black
  asphalt: THREE.MeshStandardMaterial;     // L1 slab
  painted: THREE.MeshStandardMaterial;     // L1 walls and columns
  /** L!, the lobby remembered wrong — an atlas of ROT_WALL_SHEETS sheets */
  rotWall: THREE.MeshStandardMaterial;
  rotCarpet: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  fixtureOn: THREE.MeshStandardMaterial;   // glowing lamp panel
  fixtureOff: THREE.MeshStandardMaterial;
  fixtureFrame: THREE.MeshStandardMaterial;
}

let cached: WorldMaterials | null = null;

export function getWorldMaterials(): WorldMaterials {
  if (cached) return cached;

  const wallTex = toTexture(wallpaper());
  // one carpet tile spans 4 m (two cells) — the coarse damp patches repeat far
  // enough apart that the eye stops finding the seam
  const carpetTex = toTexture(carpet(), 0.5, 0.5);
  const ceilTex = toTexture(ceilingTiles());
  const concTex = toTexture(concrete());
  // poolrooms: pale tile that has been under water and humidity for years —
  // dirty grout, algae shadowing the corners, nothing sterile about it
  const tileWallTex = toTexture(poolTile('#c9d0c4', '#b2c1ba', 'rgba(146,154,144,0.55)', 'rgba(96,122,104,0.22)', 13));
  const tileFloorTex = toTexture(poolTile('#bcc4b8', '#a6b5ac', 'rgba(136,144,134,0.55)', 'rgba(88,112,96,0.26)', 15));
  const deepTileTex = toTexture(poolTile('#5c6b64', '#465550', 'rgba(44,54,50,0.6)', 'rgba(18,32,26,0.34)', 14));
  const metalTex = toTexture(metal());
  // the slab is one big pour: a 4 m repeat keeps the aggregate from tiling
  const asphaltTex = toTexture(asphalt(), 0.5, 0.5);
  const paintedTex = toTexture(paintedBlock());
  const rotWallTex = toTexture(rottenWallpaperAtlas());
  const rotCarpetTex = toTexture(rottenCarpet(), 0.5, 0.5);

  cached = {
    wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.93, metalness: 0 }),
    carpet: new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 1.0, metalness: 0 }),
    ceiling: new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.95, metalness: 0 }),
    concrete: new THREE.MeshStandardMaterial({ map: concTex, roughness: 0.97, metalness: 0 }),
    tileWall: new THREE.MeshStandardMaterial({ map: tileWallTex, roughness: 0.35, metalness: 0.05 }),
    tileFloor: new THREE.MeshStandardMaterial({ map: tileFloorTex, roughness: 0.3, metalness: 0.05 }),
    deepTile: new THREE.MeshStandardMaterial({ map: deepTileTex, roughness: 0.45, metalness: 0.05 }),
    // slightly glossy: a car park floor is always a bit damp
    asphalt: new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.72, metalness: 0.04 }),
    painted: new THREE.MeshStandardMaterial({ map: paintedTex, roughness: 0.9, metalness: 0 }),
    rotWall: new THREE.MeshStandardMaterial({ map: rotWallTex, roughness: 0.96, metalness: 0 }),
    rotCarpet: new THREE.MeshStandardMaterial({ map: rotCarpetTex, roughness: 1, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ map: metalTex, roughness: 0.72, metalness: 0.55 }),
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
