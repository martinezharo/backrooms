// Rebuilds src/audio/clips/steps/ from the original CC0 downloads.
//
// The clips in the repo are the output of this script, so nothing about them is
// hand-tweaked and the provenance in clips/CREDITS.md stays checkable: it fetches
// the source packs, cuts one step out of each take, levels the takes of a surface
// against each other and encodes them the same way as the haunting clips.
//
// Needs `ffmpeg` and `7za` on PATH. Usage: node scripts/footsteps.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = new URL('../src/audio/clips/steps/', import.meta.url).pathname;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'footsteps-'));
const SR = 48000;

const PACKS = [
  // haeldb — cloth and leather shoes, recorded indoors and dry. Both surfaces
  // come from here on purpose: one pair of shoes, two floors, which is what a
  // player crossing from carpet into a tunnel actually is.
  { url: 'https://opengameart.org/sites/default/files/footsteps.zip', archive: 'zip' },
  // rubberduck — the water material: a movement loop and a few impacts
  { url: 'https://opengameart.org/sites/default/files/water-splash-slime-sfx.zip', archive: 'zip' },
];

/** surface -> seconds to keep, and which take feeds which foot */
const PLAN = {
  carpet: {
    seconds: 0.3,
    l: ['footsteps/step_cloth1.ogg', 'footsteps/step_cloth3.ogg'],
    r: ['footsteps/step_cloth2.ogg', 'footsteps/step_cloth4.ogg'],
  },
  hard: {
    seconds: 0.3,
    l: ['footsteps/step_lth1.ogg', 'footsteps/step_lth33.ogg'],
    r: ['footsteps/step_lth2.ogg', 'footsteps/step_lth4.ogg'],
  },
};

/** landing in water, and hitting the surface from a jump */
const IMPACTS = { seconds: 0.5, takes: ['splash_10.ogg', 'splash_14.ogg', 'splash_15.ogg'] };

/**
 * Wading is a continuous sound, not a series of steps: what you hear crossing a
 * flooded room is water being pushed around, so it ships as one loop the engine
 * swells with each stride. The tail is crossfaded back over the head so the
 * seam is inaudible.
 */
const WADE = { source: 'loop_water_01.ogg', crossfade: 0.35 };

const ff = (args, input) =>
  execFileSync('ffmpeg', ['-v', 'error', ...args], { input, maxBuffer: 1 << 28 });

function decode(file) {
  const raw = ff(['-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']);
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4)).slice();
}

/** drop the silence the recordist left in front of the step, keep 5 ms of run-up */
function trimHead(d) {
  let i = 0;
  while (i < d.length && Math.abs(d[i]) < 0.004) i++;
  return d.subarray(Math.max(0, i - Math.floor(0.005 * SR)));
}

function shape(d, seconds) {
  const out = d.slice(0, Math.floor(seconds * SR));
  const fade = Math.floor(0.03 * SR);
  const lead = Math.floor(0.002 * SR);
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

for (const pack of PACKS) {
  const file = path.join(WORK, path.basename(pack.url));
  execFileSync('curl', ['-sSL', '--max-time', '120', '-A', 'Mozilla/5.0', '-o', file, pack.url]);
  if (pack.archive === 'zip') execFileSync('unzip', ['-o', '-q', file, '-d', WORK]);
  else execFileSync('7za', ['x', '-y', `-o${WORK}`, file], { stdio: 'ignore' });
}

fs.mkdirSync(OUT, { recursive: true });

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

const peakOf = (list) => {
  let peak = 0;
  for (const d of list) for (const v of d) peak = Math.max(peak, Math.abs(v));
  return peak;
};

for (const [surface, plan] of Object.entries(PLAN)) {
  const takes = new Map();
  for (const foot of ['l', 'r']) {
    plan[foot].forEach((name, i) => {
      takes.set(`${foot}${i + 1}`, shape(trimHead(decode(findFile(name))), plan.seconds));
    });
  }

  // Level the whole surface off its loudest take rather than each take on its
  // own: within one surface the takes differ in weight, and that difference is
  // the recording being honest about a body. Across surfaces the balance is set
  // by STEP_GAIN in AudioEngine.
  const gain = 0.89 / peakOf(takes.values());
  for (const [name, d] of takes) encode(`step_${surface}_${name}`, d, gain);
}

{
  const takes = IMPACTS.takes.map((n) => shape(trimHead(decode(findFile(n))), IMPACTS.seconds));
  const gain = 0.89 / peakOf(takes);
  takes.forEach((d, i) => encode(`water_impact_${i + 1}`, d, gain));
}

{
  const d = decode(findFile(WADE.source));
  const fade = Math.floor(WADE.crossfade * SR);
  const out = d.slice(0, d.length - fade);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    out[i] = out[i] * k + d[d.length - fade + i] * (1 - k);
  }
  encode('wade_loop', out, 0.89 / peakOf([out]));
}

fs.rmSync(WORK, { recursive: true, force: true });
