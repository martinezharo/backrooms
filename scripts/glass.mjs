// Rebuilds src/audio/clips/glass_break_*.mp3 from the original CC0 downloads.
//
// A bottle going off used to be synthesized, and it never stopped sounding like
// four oscillators agreeing on a chord: shattering glass is hundreds of
// inharmonic events in the first 30 ms and no synthesis of that scale survives
// contact with the ear. Same rule the footsteps already follow — record it or
// don't ship it.
//
// Three takes rather than one, because the bottle is a weapon you throw over
// and over, and one buffer replayed is a sample you can hear repeating.
//
// Needs `ffmpeg` and `unzip` on PATH. Usage: node scripts/glass.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = new URL('../src/audio/clips/', import.meta.url).pathname;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-'));
const SR = 48000;

const SOURCES = [
  { url: 'https://opengameart.org/sites/default/files/glass_breaking.wav' },
  { url: 'https://opengameart.org/sites/default/files/sfx_100_v2.zip', archive: 'zip' },
];

/**
 * Picked on weight, not on length. A bottle hitting a floor puts real low-mid
 * energy into the first 40 ms and then keeps shedding debris; takes that are
 * all top end read as coins being dropped, however "glassy" they look in a
 * waveform. Measured on the candidates, as low/(low+high) at the transient:
 * these three sit at 0.74, 0.79 and 0.55, against 0.02–0.13 for the bright
 * tinkles that got rejected.
 */
const TAKES = [
  'glass_breaking.wav',        // TinyWorlds — the heaviest, with a 1 s debris tail
  'sfx100v2_glass_02.ogg',     // rubberduck — close-mic'd, hard floor
  'sfx100v2_glass_06.ogg',     // rubberduck — lighter, still has a body to it
];

/** long enough to keep the debris; the takes fade out well before this */
const SECONDS = 1.25;

const ff = (args, input) =>
  execFileSync('ffmpeg', ['-v', 'error', ...args], { input, maxBuffer: 1 << 28 });

function decode(file) {
  const raw = ff(['-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']);
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4)).slice();
}

/** drop the silence in front of the smash — the transient has to land on time */
function trimHead(d) {
  let i = 0;
  while (i < d.length && Math.abs(d[i]) < 0.004) i++;
  return d.subarray(Math.max(0, i - Math.floor(0.002 * SR)));
}

function shape(d) {
  const out = d.slice(0, Math.floor(SECONDS * SR));
  const fade = Math.floor(0.05 * SR);
  const lead = Math.floor(0.001 * SR);
  for (let i = 0; i < fade && i < out.length; i++) out[out.length - 1 - i] *= i / fade;
  for (let i = 0; i < lead && i < out.length; i++) out[i] *= i / lead; // de-click the cut
  return out;
}

function findFile(name) {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(name)) hits.push(p);
    }
  };
  walk(WORK);
  if (!hits.length) throw new Error(`missing source take: ${name}`);
  return hits[0];
}

function encode(name, samples, gain) {
  const pcm = Buffer.alloc(samples.length * 4);
  for (let i = 0; i < samples.length; i++) {
    pcm.writeFloatLE(Math.max(-1, Math.min(1, samples[i] * gain)), i * 4);
  }
  const dst = path.join(OUT, `${name}.mp3`);
  ff(['-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-',
    '-ar', '32000', '-ac', '1', '-b:a', '64k', dst], pcm);
  console.log(path.basename(dst), (samples.length / SR).toFixed(3) + 's', fs.statSync(dst).size + 'B');
}

for (const src of SOURCES) {
  const file = path.join(WORK, path.basename(src.url));
  execFileSync('curl', ['-sSL', '--max-time', '180', '-A', 'Mozilla/5.0', '-o', file, src.url]);
  if (src.archive === 'zip') execFileSync('unzip', ['-o', '-q', file, '-d', WORK]);
}

const takes = TAKES.map((n) => shape(trimHead(decode(findFile(n)))));

// Levelled off the loudest take, not each one on its own: these are three
// bottles hitting the same floor, and flattening them to an identical peak is
// what would make the repeat audible again.
let peak = 0;
for (const d of takes) for (const v of d) peak = Math.max(peak, Math.abs(v));
takes.forEach((d, i) => encode(`glass_break_${i + 1}`, d, 0.89 / peak));

fs.rmSync(WORK, { recursive: true, force: true });
