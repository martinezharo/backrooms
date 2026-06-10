// Seeded, deterministic randomness for infinite world generation.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix integer coordinates with a seed into a 32-bit hash. */
export function hash2(seed: number, x: number, y: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

export function hash3(seed: number, x: number, y: number, z: number): number {
  return hash2(hash2(seed, x, y), z, 0x9e3779b9);
}

export function chunkRng(seed: number, cx: number, cz: number, salt = 0): Rng {
  return mulberry32(hash3(seed, cx, cz, salt));
}

function valueAt(seed: number, xi: number, yi: number): number {
  return hash2(seed, xi, yi) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 2D value noise in [0,1], continuous over world coordinates. */
export function valueNoise2(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smooth(x - xi);
  const ty = smooth(y - yi);
  const v00 = valueAt(seed, xi, yi);
  const v10 = valueAt(seed, xi + 1, yi);
  const v01 = valueAt(seed, xi, yi + 1);
  const v11 = valueAt(seed, xi + 1, yi + 1);
  return v00 + (v10 - v00) * tx + ((v01 + (v11 - v01) * tx) - (v00 + (v10 - v00) * tx)) * ty;
}

/** Fractal value noise in [0,1]. */
export function fbm2(seed: number, x: number, y: number, octaves = 3): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(seed + i * 1013, x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function randInt(rng: Rng, min: number, maxExclusive: number): number {
  return min + Math.floor(rng() * (maxExclusive - min));
}
