// Almost everything you hear is synthesized at runtime. SFX are pre-rendered
// into AudioBuffers; ambiences are live node graphs crossfaded per biome; enemy
// cues are one-shot buffers placed on PositionalAudio at AI moments.
//
// The exceptions are the hauntings and the footsteps (see clips/CREDITS.md): a
// scream, a whisper, a boot landing on concrete — synthesis gets you a
// synthesizer pretending, and you hear the difference immediately. Footsteps in
// particular are the sound you hear most in the whole game, so they get real
// recordings and the ear is left nothing to catch.

import * as THREE from 'three';

import dragScrapeUrl from './clips/drag_scrape.mp3?url';
import earWhisperUrl from './clips/ear_whisper.mp3?url';
import farBangUrl from './clips/far_bang.mp3?url';
import farScreamUrl from './clips/far_scream.mp3?url';
import glassBreak1 from './clips/glass_break_1.mp3?url';
import glassBreak2 from './clips/glass_break_2.mp3?url';
import glassBreak3 from './clips/glass_break_3.mp3?url';
import metalFallUrl from './clips/metal_fall.mp3?url';
import stepCarpetL1 from './clips/steps/step_carpet_l1.mp3?url';
import stepCarpetL2 from './clips/steps/step_carpet_l2.mp3?url';
import stepCarpetR1 from './clips/steps/step_carpet_r1.mp3?url';
import stepCarpetR2 from './clips/steps/step_carpet_r2.mp3?url';
import stepHardL1 from './clips/steps/step_hard_l1.mp3?url';
import stepHardL2 from './clips/steps/step_hard_l2.mp3?url';
import stepHardR1 from './clips/steps/step_hard_r1.mp3?url';
import stepHardR2 from './clips/steps/step_hard_r2.mp3?url';
import wadeLoopUrl from './clips/steps/wade_loop.mp3?url';
import waterImpact1 from './clips/steps/water_impact_1.mp3?url';
import waterImpact2 from './clips/steps/water_impact_2.mp3?url';
import waterImpact3 from './clips/steps/water_impact_3.mp3?url';

type AmbienceId = 'hum' | 'garage' | 'tunnel' | 'pool' | 'deep' | 'wrong';
/**
 * Only two dry surfaces, deliberately. The tunnels and the poolrooms tried a
 * stone recording for a while and it read as gravel underfoot — an outdoor
 * sound in a building. One neutral indoor step covers every floor that isn't
 * carpet and stops the ear asking questions.
 */
type Surface = 'carpet' | 'hard';

/**
 * Recorded steps, kept in left/right pairs. Two feet on one body are close but
 * never identical, and alternating real takes is what stops a walk cycle from
 * turning into a loop you can hear repeating.
 */
const STEP_CLIPS: Record<Surface, { l: string[]; r: string[] }> = {
  carpet: { l: [stepCarpetL1, stepCarpetL2], r: [stepCarpetR1, stepCarpetR2] },
  hard: { l: [stepHardL1, stepHardL2], r: [stepHardR1, stepHardR2] },
};

const WATER_IMPACTS = [waterImpact1, waterImpact2, waterImpact3];

/**
 * Recorded one-shots that stand in for a synthesized name. Shattering glass is
 * hundreds of inharmonic events inside the first 30 ms; synthesis of that only
 * ever produced a chord, so the bottle gets three real takes and picks one per
 * smash. See clips/CREDITS.md and scripts/glass.mjs.
 */
const SFX_CLIPS: Record<string, string[]> = {
  glassBreak: [glassBreak1, glassBreak2, glassBreak3],
};

/** how loud each surface sits, after the clips were levelled against each other */
const STEP_GAIN: Record<Surface, number> = { carpet: 0.34, hard: 0.38 };

function makeBuffer(ctx: AudioContext, seconds: number, fill: (data: Float32Array, sr: number) => void): AudioBuffer {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.ceil(seconds * sr), sr);
  fill(buf.getChannelData(0), sr);
  return buf;
}

/** crude one-pole lowpass over a sample array, in place */
function lowpass(data: Float32Array, k: number): void {
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y += (data[i] - y) * k;
    data[i] = y;
  }
}

function envExp(i: number, sr: number, decay: number): number {
  return Math.exp((-i / sr) * decay);
}


/** how a haunting is placed around your head */
interface HauntOptions {
  /** metres-ish: 0.3 is against your ear, 30 is somewhere down the corridor */
  distance?: number;
  /** starting angle in radians, 0 = ahead, positive = to your right */
  azimuth?: number;
  /** orbit speed in rad/s — this is what makes it swim around you */
  spin?: number;
  volume?: number;
}

const HAUNTINGS: { name: string; url: string; weight: number; place: () => HauntOptions }[] = [
  {
    // a scream several rooms away, drowned in reverb
    name: 'far_scream',
    url: farScreamUrl,
    weight: 1,
    place: () => ({ distance: 22 + Math.random() * 18, spin: (Math.random() - 0.5) * 0.5, volume: 1 }),
  },
  {
    // shelving, pipes, something heavy giving way
    name: 'metal_fall',
    url: metalFallUrl,
    weight: 1.1,
    place: () => ({ distance: 11 + Math.random() * 16, spin: (Math.random() - 0.5) * 0.7, volume: 0.95 }),
  },
  {
    // a door, or a body, hitting a wall
    name: 'far_bang',
    url: farBangUrl,
    weight: 0.9,
    place: () => ({ distance: 17 + Math.random() * 18, spin: (Math.random() - 0.5) * 0.4, volume: 0.9 }),
  },
  {
    // something dragged across the carpet, circling
    name: 'drag_scrape',
    url: dragScrapeUrl,
    weight: 0.8,
    place: () => ({ distance: 6 + Math.random() * 8, spin: (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5), volume: 0.85 }),
  },
  {
    // right behind your ear — close enough that you check the headphones
    name: 'ear_whisper',
    url: earWhisperUrl,
    weight: 0.7,
    place: () => ({
      distance: 0.3,
      azimuth: Math.PI + (Math.random() - 0.5) * 1.2,
      spin: (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.7),
      volume: 0.75,
    }),
  },
];

export class AudioEngine {
  listener = new THREE.AudioListener();
  private ctx: AudioContext;
  private master: GainNode;
  private sfxBus: GainNode;
  private ambBus: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private ambGraphs = new Map<AmbienceId, GainNode>();
  private currentAmbience: AmbienceId | null = null;
  private sfxReady = false;
  private sfxIdleScheduled = false;
  private hauntBus: GainNode;
  private hauntWet: GainNode;
  private muffled = false;
  private dripTimer = 0;
  private stage: THREE.Object3D | null = null;
  private hauntTimer = 25 + Math.random() * 35;
  private dread = 0;
  private sprayNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private stepOnsets = new Map<string, number>();
  /** logical sfx name -> clip urls that actually decoded */
  private sfxVariants = new Map<string, string[]>();
  private stepVariant = 0;
  private stepLeft = false;
  private wadeNode: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private wadeLevel = 0;
  private windNode: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;

  constructor() {
    this.ctx = this.listener.context;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.listener.gain as unknown as AudioNode);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(this.master);

    this.ambBus = this.ctx.createGain();
    this.ambBus.gain.value = 0.8;

    // generated impulse-response reverb on the ambience bus
    const convolver = this.ctx.createConvolver();
    convolver.buffer = makeBuffer(this.ctx, 1.8, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        d[i] = (Math.random() * 2 - 1) * envExp(i, sr, 3.2) * 0.5;
      }
    });
    this.ambBus.connect(convolver);
    convolver.connect(this.master);
    this.ambBus.connect(this.master);

    // Hauntings get their own bus: a long, dark tail so the far ones sound like
    // they crossed a lot of empty rooms to reach you. It bypasses the listener's
    // 3D panning on purpose — these are placed relative to your head, not the world.
    this.hauntBus = this.ctx.createGain();
    this.hauntBus.gain.value = 1;
    this.hauntBus.connect(this.master);

    const hall = this.ctx.createConvolver();
    hall.buffer = makeBuffer(this.ctx, 3.6, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        d[i] = (Math.random() * 2 - 1) * envExp(i, sr, 1.5) * 0.6;
      }
      lowpass(d, 0.15);
    });
    this.hauntWet = this.ctx.createGain();
    this.hauntWet.gain.value = 1;
    this.hauntWet.connect(hall);
    hall.connect(this.hauntBus);
  }

  /** Prepare the procedural buffers away from the landing-page critical path. */
  prepareWhenIdle(): void {
    if (this.sfxReady || this.sfxIdleScheduled) return;
    this.sfxIdleScheduled = true;
    const win = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (win.requestIdleCallback) {
      win.requestIdleCallback(() => this.prepareSfx(), { timeout: 1800 });
    } else {
      window.setTimeout(() => this.prepareSfx(), 0);
    }
  }

  private prepareSfx(): void {
    if (this.sfxReady) return;
    this.sfxReady = true;
    this.synthesizeSfx();
    void this.loadHauntClips();
    void this.loadStepClips();
    void this.loadSfxClips();
  }

  /**
   * Steps are the one recorded sound that has to be ready early, so they load
   * alongside the hauntings rather than on first use. MP3 decoders hand back a
   * few milliseconds of encoder padding at the head of the buffer; we find the
   * real onset once, here, and start playback from it — otherwise every step
   * lands late by a hair and the whole walk feels rubbery.
   */
  private async loadStepClips(): Promise<void> {
    const urls = [
      ...Object.values(STEP_CLIPS).flatMap((feet) => [...feet.l, ...feet.r]),
      ...WATER_IMPACTS,
      wadeLoopUrl,
    ];
    await Promise.all(
      urls.map(async (url) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
          const d = buf.getChannelData(0);
          let onset = 0;
          while (onset < d.length && Math.abs(d[onset]) < 0.002) onset++;
          this.buffers.set(url, buf);
          this.stepOnsets.set(url, onset / buf.sampleRate);
        } catch {
          // a step that never arrived is silent, not fatal
        }
      }),
    );
  }

  /**
   * Recorded stand-ins for synthesized one-shots. Only the takes that decode
   * get registered, so a clip that never arrived falls back to whatever is
   * synthesized under the same name rather than going silent.
   */
  private async loadSfxClips(): Promise<void> {
    await Promise.all(Object.entries(SFX_CLIPS).map(async ([name, urls]) => {
      const loaded: string[] = [];
      await Promise.all(urls.map(async (url) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          this.buffers.set(url, await this.ctx.decodeAudioData(await res.arrayBuffer()));
          loaded.push(url);
        } catch {
          // one missing take just means less variety
        }
      }));
      if (loaded.length) this.sfxVariants.set(name, loaded);
    }));
  }

  /**
   * The only fetched audio in the game. Small, lazy, and failure is survivable:
   * a haunting whose clip never arrived simply doesn't happen.
   */
  private async loadHauntClips(): Promise<void> {
    await Promise.all(
      HAUNTINGS.map(async (h) => {
        try {
          const res = await fetch(h.url);
          if (!res.ok) return;
          this.buffers.set(h.name, await this.ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          // offline, or the asset didn't ship — stay quiet rather than break the run
        }
      }),
    );
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  async suspend(): Promise<void> {
    if (this.ctx.state === 'running') await this.ctx.suspend();
  }

  getContext(): AudioContext {
    return this.ctx;
  }

  getMusicDestination(): AudioNode {
    return this.master;
  }

  // ------------------------------------------------------------------ SFX

  private synthesizeSfx(): void {
    const ctx = this.ctx;
    const B = this.buffers;

    B.set('splash', makeBuffer(ctx, 0.7, (d, sr) => {
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * envExp(i, sr, 7) * 0.8;
      lowpass(d, 0.18);
    }));
    B.set('gulp', makeBuffer(ctx, 0.3, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = Math.sin(2 * Math.PI * (160 - t * 220) * t) * envExp(i, sr, 14) * 0.5;
      }
    }));
    B.set('punch', makeBuffer(ctx, 0.15, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = (Math.sin(2 * Math.PI * 70 * t) + (Math.random() - 0.5)) * envExp(i, sr, 38) * 0.8;
      }
      lowpass(d, 0.25);
    }));
    B.set('swing', makeBuffer(ctx, 0.28, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const env = Math.sin(Math.PI * Math.min(1, t / 0.28));
        d[i] = (Math.random() * 2 - 1) * env * 0.35;
      }
      lowpass(d, 0.5);
    }));
    B.set('hit', makeBuffer(ctx, 0.2, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = (Math.sin(2 * Math.PI * 95 * t) * 0.7 + (Math.random() - 0.5) * 0.8) * envExp(i, sr, 30);
      }
      lowpass(d, 0.35);
    }));
    B.set('gunshot', makeBuffer(ctx, 0.9, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const crack = (Math.random() * 2 - 1) * envExp(i, sr, 26);
        const boom = Math.sin(2 * Math.PI * 55 * t) * envExp(i, sr, 8) * 0.9;
        d[i] = (crack + boom) * 0.9;
      }
    }));
    B.set('click', makeBuffer(ctx, 0.06, (d, sr) => {
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * envExp(i, sr, 160) * 0.4;
      lowpass(d, 0.6);
    }));
    B.set('reload', makeBuffer(ctx, 0.5, (d, sr) => {
      for (const at of [0.0, 0.18, 0.36]) {
        const start = Math.floor(at * sr);
        for (let i = 0; i < 0.05 * sr && start + i < d.length; i++) {
          d[start + i] += (Math.random() * 2 - 1) * envExp(i, sr, 120) * 0.5;
        }
      }
      lowpass(d, 0.5);
    }));
    B.set('throw', B.get('swing')!);
    // 'glassBreak' is not synthesized: it is three recordings (SFX_CLIPS).
    // Every attempt at synthesizing it landed on a chord, because shattering
    // glass is hundreds of inharmonic events in the first 30 ms and additive
    // synthesis at that scale just rings.
    B.set('itemBreak', makeBuffer(ctx, 0.45, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = (Math.sin(2 * Math.PI * 320 * t) * 0.4 + (Math.random() - 0.5)) * envExp(i, sr, 16) * 0.6;
      }
      lowpass(d, 0.4);
    }));
    B.set('pickup', makeBuffer(ctx, 0.22, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const f = t < 0.1 ? 520 : 690;
        d[i] = Math.sin(2 * Math.PI * f * t) * envExp(i, sr, 16) * 0.3;
      }
    }));
    B.set('drip', makeBuffer(ctx, 0.5, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = Math.sin(2 * Math.PI * (900 - t * 700) * t) * envExp(i, sr, 24) * 0.35;
      }
    }));
    B.set('spray', makeBuffer(ctx, 1.0, (d) => {
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.4;
      lowpass(d, 0.55);
    }));
    B.set('ping', makeBuffer(ctx, 0.14, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = Math.sin(2 * Math.PI * 1750 * t) * envExp(i, sr, 42) * 0.28;
      }
    }));
    B.set('fuseIn', makeBuffer(ctx, 0.7, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const clunk = (Math.random() - 0.5) * envExp(i, sr, 60) * 0.9;
        const hum = Math.sin(2 * Math.PI * (90 + t * 120) * t) * envExp(i, sr, 4) * 0.4;
        d[i] = clunk + hum;
      }
      lowpass(d, 0.4);
    }));
    B.set('portalOpen', makeBuffer(ctx, 3.4, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const rise = Math.pow(t / 3.4, 0.7);
        let v = 0;
        for (const f of [110, 165, 220, 330]) {
          v += Math.sin(2 * Math.PI * f * (1 + rise * 3) * t);
        }
        const air = (Math.random() * 2 - 1) * rise * 0.5;
        d[i] = (v * 0.14 + air) * Math.min(1, t * 3) * (1 - Math.pow(t / 3.4, 4));
      }
    }));
    B.set('whoosh', makeBuffer(ctx, 2.2, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const env = Math.sin(Math.PI * Math.min(1, t / 2.2)) ** 1.5;
        d[i] = (Math.random() * 2 - 1) * env * 0.85;
      }
      lowpass(d, 0.08);
    }));
    B.set('windLoop', makeBuffer(ctx, 4, (d) => {
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      lowpass(d, 0.35);
      // taper the seam so the loop doesn't tick
      const n = d.length;
      for (let i = 0; i < 2000; i++) {
        const k = i / 2000;
        d[i] *= k;
        d[n - 1 - i] *= k;
      }
    }));

    // ---- the way down (one per floor, and each floor sounds like itself) ----
    B.set('carAlarm', makeBuffer(ctx, 2.6, (d, sr) => {
      // the two-tone yelp, repeated, the way every car in the world does it
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const step = Math.floor(t * 7) % 2;
        const f = step ? 1180 : 880;
        const gate = ((t * 7) % 1) < 0.72 ? 1 : 0;
        const fade = 1 - Math.pow(t / 2.6, 3);
        d[i] = (Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.16
          + Math.sin(2 * Math.PI * f * 2 * t) * 0.05) * gate * fade;
      }
      lowpass(d, 0.6);
    }));
    B.set('shutter', makeBuffer(ctx, 3.2, (d, sr) => {
      // a rolling door: a motor, and every slat hitting the next one
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const motor = Math.sin(2 * Math.PI * 74 * t) * 0.18
          + Math.sin(2 * Math.PI * 149 * t) * 0.07;
        const rattle = ((t * 26) % 1) < 0.08 ? (Math.random() - 0.5) * 0.7 : 0;
        const env = Math.min(1, t * 4) * (1 - Math.pow(Math.max(0, t - 2.4) / 0.8, 2));
        d[i] = (motor + rattle) * Math.max(0, env);
      }
      lowpass(d, 0.45);
    }));
    B.set('valve', makeBuffer(ctx, 1.4, (d, sr) => {
      // metal that has not moved in years, deciding to
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const squeal = Math.sin(2 * Math.PI * (420 + Math.sin(t * 19) * 90) * t) * 0.13;
        const grind = (Math.random() - 0.5) * 0.28;
        d[i] = (squeal + grind) * Math.min(1, t * 6) * (1 - t / 1.4);
      }
      lowpass(d, 0.3);
    }));
    B.set('flood', makeBuffer(ctx, 4, (d, sr) => {
      // a column of water arriving from somewhere above you
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = (Math.random() * 2 - 1) * Math.min(1, t * 1.5) * 0.7;
      }
      lowpass(d, 0.22);
    }));
    B.set('clunk', makeBuffer(ctx, 0.9, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const body = Math.sin(2 * Math.PI * 96 * t) * envExp(i, sr, 9) * 0.7;
        const hit = (Math.random() - 0.5) * envExp(i, sr, 55) * 0.8;
        d[i] = body + hit;
      }
      lowpass(d, 0.32);
    }));
    B.set('beep', makeBuffer(ctx, 0.11, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = Math.sign(Math.sin(2 * Math.PI * 1420 * t)) * envExp(i, sr, 26) * 0.14;
      }
    }));
    B.set('deny', makeBuffer(ctx, 0.6, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const gate = ((t * 6) % 1) < 0.6 ? 1 : 0;
        d[i] = Math.sign(Math.sin(2 * Math.PI * 190 * t)) * gate * 0.16 * (1 - t / 0.6);
      }
      lowpass(d, 0.5);
    }));
    B.set('crumble', makeBuffer(ctx, 1.6, (d, sr) => {
      // plaster and paper letting go of a wall that was never load-bearing
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const tear = (Math.random() - 0.5) * Math.pow(1 - t / 1.6, 1.5);
        const thud = Math.sin(2 * Math.PI * 58 * t) * envExp(i, sr, 5) * 0.5;
        d[i] = tear * 0.55 + thud;
      }
      lowpass(d, 0.35);
    }));
    B.set('gasp', makeBuffer(ctx, 1.1, (d, sr) => {
      // the breath you take when your head clears the surface
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const inhale = Math.pow(Math.min(1, t / 0.32), 2) * Math.pow(Math.max(0, 1 - (t - 0.32) / 0.7), 1.6);
        d[i] = (Math.random() * 2 - 1) * inhale * 0.4;
      }
      lowpass(d, 0.4);
    }));
    B.set('heartbeat', makeBuffer(ctx, 1.1, (d, sr) => {
      // what you hear instead of the room, once the oxygen bar goes red
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const beat = (u: number) => Math.exp(-Math.pow((t - u) * 14, 2));
        d[i] = Math.sin(2 * Math.PI * 46 * t) * (beat(0.1) + beat(0.34) * 0.7) * 0.75;
      }
      lowpass(d, 0.18);
    }));

    // ---- enemy cues (one-shots, played at AI moments) ----
    B.set('whisper', makeBuffer(ctx, 1.2, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const win = Math.sin(Math.PI * Math.min(1, t / 1.2));
        const syll = Math.max(0, Math.sin(2 * Math.PI * 3.1 * t + Math.sin(t * 7) * 1.5)) ** 2;
        d[i] = (Math.random() * 2 - 1) * syll * win * 0.5;
      }
      lowpass(d, 0.25);
    }));
    B.set('growl', makeBuffer(ctx, 1.0, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const f = 62 + Math.sin(2 * Math.PI * 28 * t) * 18;
        const v = Math.sin(2 * Math.PI * f * t) * 0.7 + (Math.random() - 0.5) * 0.5;
        d[i] = v * Math.min(1, t * 8) * envExp(i, sr, 3.5) * 0.6;
      }
      lowpass(d, 0.2);
    }));
    B.set('stinger', makeBuffer(ctx, 1.6, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const rise = 1 + Math.min(1, t / 0.6) * 0.35;
        let v = 0;
        for (const f of [180, 190.5, 240]) {
          v += 2 * ((f * rise * t) % 1) - 1;
        }
        const crack = (Math.random() * 2 - 1) * envExp(i, sr, 9) * 0.8;
        d[i] = (v * 0.16 + crack) * Math.min(1, t * 20) * envExp(i, sr, 1.6);
      }
      lowpass(d, 0.35);
    }));

    // ---- enemy voices (one-shot cue material) ----
    B.set('voice_smiler', makeBuffer(ctx, 3, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const am = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.4 * t + Math.sin(t * 2.3) * 2);
        d[i] = (Math.random() * 2 - 1) * am * 0.16;
      }
      lowpass(d, 0.08);
    }));
    B.set('voice_stealer', makeBuffer(ctx, 4, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const f = 105 + Math.sin(t * 3.1) * 18 + Math.sin(t * 0.7) * 10;
        const am = Math.max(0, Math.sin(2 * Math.PI * 0.55 * t)) ** 2;
        d[i] = (Math.sin(2 * Math.PI * f * t) * 0.6 + Math.sin(2 * Math.PI * f * 2.02 * t) * 0.3) * am * 0.35;
      }
    }));
    B.set('voice_hound', makeBuffer(ctx, 2, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const pant = Math.max(0, Math.sin(2 * Math.PI * 2.6 * t)) ** 3;
        d[i] = (Math.random() * 2 - 1) * pant * 0.3;
      }
      lowpass(d, 0.2);
    }));
    B.set('voice_partygoer', makeBuffer(ctx, 3.5, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const burst = Math.max(0, Math.sin(2 * Math.PI * 1.1 * t)) ** 4;
        const f = 300 + ((t * 4) % 1) * 160;
        d[i] = Math.sin(2 * Math.PI * f * t) * burst * 0.2;
      }
    }));
  }

  playSfx(name: string, volume = 1, rateJitter = 0.08): void {
    this.prepareSfx();
    // a name backed by recordings plays a different take each time
    const takes = this.sfxVariants.get(name);
    const buf = this.buffers.get(
      takes ? takes[Math.floor(Math.random() * takes.length)] : name,
    );
    if (!buf || this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * rateJitter * 2;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g);
    g.connect(this.sfxBus);
    src.start();
  }

  /**
   * @param intensity 0 for a slow walk, 1 for a full sprint — moves weight and
   *   brightness together, so running lands harder rather than just louder.
   */
  footstep(surface: Surface, intensity = 1): void {
    this.prepareSfx();
    this.stepLeft = !this.stepLeft;
    const takes = this.stepLeft ? STEP_CLIPS[surface].l : STEP_CLIPS[surface].r;
    // walk the takes rather than pick at random: random repeats itself, and a
    // step landing twice on the same recording is exactly what the ear catches
    this.stepVariant = (this.stepVariant + 1) % takes.length;
    const url = takes[this.stepVariant];

    const buf = this.buffers.get(url);
    if (!buf || this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // just enough pitch drift to blur the seams — these are real takes, so they
    // need far less help than the synthesized ones did
    src.playbackRate.value = (1 + (Math.random() - 0.5) * 0.06) * (1.03 - intensity * 0.05);

    // a fast step is a harder step: it lands louder and keeps more of its top end
    const tone = this.ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200 + intensity * 9000;

    const g = this.ctx.createGain();
    g.gain.value = STEP_GAIN[surface] * (0.55 + intensity * 0.55);
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = (this.stepLeft ? -0.16 : 0.16) * (0.7 + Math.random() * 0.6);
    src.connect(tone).connect(g).connect(pan).connect(this.sfxBus);
    src.start(0, this.stepOnsets.get(url) ?? 0);
  }

  /**
   * Both feet arriving at once. It is the same recording as a step, dropped a
   * fifth and hit much harder — pitching a real contact down is what gives it
   * the mass a jump needs, and layering the two feet a few milliseconds apart
   * keeps it from reading as one very loud step.
   *
   * @param impact 0 for stepping off a kerb, 1 for a drop that should hurt
   */
  land(surface: Surface, impact: number, inWater: boolean): void {
    this.prepareSfx();
    if (this.ctx.state !== 'running') return;
    if (inWater) {
      this.playClip(
        WATER_IMPACTS[Math.floor(Math.random() * WATER_IMPACTS.length)],
        0.3 + impact * 0.5,
        0.9 + Math.random() * 0.12,
      );
      this.wadeSurge(0.6 + impact * 0.5);
      return;
    }
    const feet = STEP_CLIPS[surface];
    const gain = STEP_GAIN[surface] * (0.9 + impact * 1.5);
    const rate = 0.68 - impact * 0.06;
    this.playClip(feet.l[Math.floor(Math.random() * feet.l.length)], gain, rate);
    this.playClip(feet.r[Math.floor(Math.random() * feet.r.length)], gain * 0.7, rate * 1.04,
      0.012 + Math.random() * 0.02);
  }

  private playClip(url: string, volume: number, rate: number, delay = 0): void {
    const buf = this.buffers.get(url);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.sfxBus);
    src.start(this.ctx.currentTime + delay, this.stepOnsets.get(url) ?? 0);
  }

  /**
   * Wading is not a sequence of footsteps — it is water being pushed around,
   * continuously, for as long as you keep moving. So it runs as a loop whose
   * level follows your speed, and each stride swells it instead of dropping a
   * separate splash on top.
   *
   * @param intensity 0 when still or out of the water, 1 at a full run
   */
  setWading(intensity: number): void {
    if (intensity <= 0 && !this.wadeNode) return;
    this.prepareSfx();
    if (this.ctx.state !== 'running') return;

    if (!this.wadeNode) {
      const buf = this.buffers.get(wadeLoopUrl);
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1600;
      src.connect(filter).connect(gain).connect(this.sfxBus);
      src.start(Math.random() * buf.duration);
      this.wadeNode = { src, gain, filter };
    }

    const { gain, filter, src } = this.wadeNode;
    this.wadeLevel = intensity;
    // slow to come up, slower to fall away: water keeps sloshing after you stop
    gain.gain.setTargetAtTime(0.42 * intensity, this.ctx.currentTime, intensity > 0.05 ? 0.12 : 0.35);
    filter.frequency.setTargetAtTime(1100 + intensity * 3200, this.ctx.currentTime, 0.2);
    src.playbackRate.setTargetAtTime(0.85 + intensity * 0.35, this.ctx.currentTime, 0.2);
  }

  /** one stride's worth of water shoved aside, ridden on top of the wade loop */
  wadeSurge(amount = 1): void {
    if (!this.wadeNode) return;
    const g = this.wadeNode.gain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(Math.min(0.95, 0.42 * this.wadeLevel + 0.3 * amount), t + 0.05);
    g.setTargetAtTime(0.42 * this.wadeLevel, t + 0.05, 0.16);
  }

  stopWading(): void {
    if (!this.wadeNode) return;
    const node = this.wadeNode;
    this.wadeNode = null;
    this.wadeLevel = 0;
    node.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    setTimeout(() => node.src.stop(), 600);
  }

  startSprayLoop(): void {
    this.prepareSfx();
    if (this.sprayNode || this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get('spray')!;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0.5;
    src.connect(g);
    g.connect(this.sfxBus);
    src.start();
    this.sprayNode = { src, gain: g };
  }

  stopSprayLoop(): void {
    if (!this.sprayNode) return;
    this.sprayNode.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    const node = this.sprayNode;
    setTimeout(() => node.src.stop(), 300);
    this.sprayNode = null;
  }

  // -------------------------------------------------------- the fall

  /** Freefall wind: filtered noise whose brightness tracks how fast you're going. */
  startWind(): void {
    this.prepareSfx();
    if (this.windNode || this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get('windLoop')!;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 300;
    filter.Q.value = 0.5;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    this.windNode = { src, gain, filter };
  }

  setWindLevel(level: number): void {
    if (!this.windNode) return;
    const t = this.ctx.currentTime;
    this.windNode.gain.gain.setTargetAtTime(level * 0.55, t, 0.15);
    this.windNode.filter.frequency.setTargetAtTime(280 + level * 1500, t, 0.2);
  }

  stopWind(): void {
    if (!this.windNode) return;
    const node = this.windNode;
    node.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    setTimeout(() => node.src.stop(), 1200);
    this.windNode = null;
  }

  /** Pull the maze's own noise down — used while falling out of it. */
  duckWorld(amount: number): void {
    const t = this.ctx.currentTime;
    this.ambBus.gain.setTargetAtTime(0.8 * (1 - amount), t, 0.4);
    this.sfxBus.gain.setTargetAtTime(1 - amount, t, 0.4);
    this.hauntBus.gain.setTargetAtTime(1 - amount, t, 0.4);
  }

  // ------------------------------------------------------------- cues

  /** One-shot positional sound attached to an object (enemy), self-removing. */
  playCueAt(name: string, parent: THREE.Object3D, volume = 1, refDist = 4): void {
    this.prepareSfx();
    const buf = this.buffers.get(name);
    if (!buf || this.ctx.state !== 'running') return;
    const audio = new THREE.PositionalAudio(this.listener);
    audio.setBuffer(buf);
    audio.setLoop(false);
    audio.setRefDistance(refDist);
    audio.setMaxDistance(40);
    audio.setVolume(volume);
    parent.add(audio);
    const baseEnded = audio.onEnded.bind(audio);
    audio.onEnded = () => {
      baseEnded();
      parent.remove(audio);
    };
    audio.play();
  }

  /**
   * Same, at a fixed point in the world rather than on a moving thing. Used by
   * anything the level owns: an alarm going off two aisles over, a shutter you
   * hear open from wherever you happened to be standing.
   */
  playSfxAt(name: string, position: THREE.Vector3, volume = 1, refDist = 8): void {
    if (!this.stage) { this.playSfx(name, volume * 0.5); return; }
    const holder = new THREE.Object3D();
    holder.position.copy(position);
    this.stage.add(holder);
    this.playCueAt(name, holder, volume, refDist);
    // playCueAt detaches the audio when it ends; the holder goes with it
    holder.addEventListener('childremoved', () => holder.removeFromParent());
  }

  /** Where world-positioned one-shots get parked while they play. */
  attachStage(stage: THREE.Object3D): void {
    this.stage = stage;
  }

  // -------------------------------------------------------- hauntings

  /**
   * Play a one-shot binaurally, orbiting your head — the "8D" trick.
   * Rather than a PannerNode (which is anchored to the world listener, so it
   * would rotate away as you turn), this builds the two ear signals by hand:
   * interaural delay, head-shadow filtering and level difference, all animated
   * along the orbit. The result sits outside the stereo image, which is what
   * makes you unsure whether it came from the game or from the room you're in.
   */
  playHaunt(name: string, opts: HauntOptions = {}): void {
    this.prepareSfx();
    const buf = this.buffers.get(name);
    if (!buf || this.ctx.state !== 'running') return;

    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const dist = opts.distance ?? 8;
    const spin = opts.spin ?? 0.4;
    const rate = 1 + (Math.random() - 0.5) * 0.14;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const dur = buf.duration / rate;

    // distance: quieter, darker, and far more reverberant the further out it is
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = Math.max(650, 19000 / (1 + dist * 0.75));

    // front/back cue: what's behind you loses its top end (pinna shadow)
    const pinna = ctx.createBiquadFilter();
    pinna.type = 'lowpass';
    pinna.frequency.value = 16000;

    const pre = ctx.createGain();
    pre.gain.value = ((opts.volume ?? 1) * 2) / (1 + dist * 0.3);
    src.connect(air);
    air.connect(pinna);
    pinna.connect(pre);

    const ears = [0, 1].map(() => ({
      delay: ctx.createDelay(0.02),
      shadow: ctx.createBiquadFilter(),
      gain: ctx.createGain(),
    }));
    const merger = ctx.createChannelMerger(2);
    ears.forEach((ear, ch) => {
      ear.shadow.type = 'lowpass';
      pre.connect(ear.delay);
      ear.delay.connect(ear.shadow);
      ear.shadow.connect(ear.gain);
      ear.gain.connect(merger, 0, ch);
    });

    const out = ctx.createGain();
    out.gain.value = 1;
    merger.connect(out);
    out.connect(this.hauntBus);
    const send = ctx.createGain();
    // close whispers stay dry; distant events arrive mostly as their own echo
    send.gain.value = Math.min(0.9, 0.12 + dist * 0.045);
    out.connect(send);
    send.connect(this.hauntWet);

    // walk the orbit, writing automation points for every ear parameter
    const BASE_DELAY = 0.0012;
    const ITD = 0.00035;
    const az0 = opts.azimuth ?? Math.random() * Math.PI * 2;
    const steps = Math.max(2, Math.ceil(dur / 0.04));
    for (let s = 0; s <= steps; s++) {
      const dt = (s / steps) * dur;
      const az = az0 + spin * dt;
      const sinA = Math.sin(az);
      const cosA = Math.cos(az);
      const time = t0 + dt;
      const set = (p: AudioParam, v: number) => {
        if (s === 0) p.setValueAtTime(v, time);
        else p.linearRampToValueAtTime(v, time);
      };
      set(pinna.frequency, 3200 + 12000 * (0.5 + 0.5 * cosA));
      ears.forEach((ear, ch) => {
        const side = ch === 0 ? -1 : 1; // -1 left ear, +1 right ear
        const toward = side * sinA; // 1 when the sound is on this ear's side
        set(ear.delay.delayTime, BASE_DELAY - ITD * toward);
        set(ear.gain.gain, 0.72 + 0.34 * toward);
        set(ear.shadow.frequency, 2200 + 14000 * (0.5 + 0.5 * toward));
      });
    }

    src.onended = () => {
      out.disconnect();
      send.disconnect();
      merger.disconnect();
      for (const ear of ears) ear.gain.disconnect();
      src.disconnect();
    };
    src.start();
  }

  /** 0..1 — how much the maze is currently pressing on you; crowds the hauntings. */
  setDread(level: number): void {
    this.dread = Math.max(0, Math.min(1, level));
  }

  private scheduleHaunting(dt: number): void {
    this.hauntTimer -= dt * (1 + this.dread * 1.6);
    if (this.hauntTimer > 0) return;
    // sparse by default, and never quite on a rhythm you could learn
    this.hauntTimer = (32 + Math.random() * 55) * (1 - this.dread * 0.4);

    const total = HAUNTINGS.reduce((sum, h) => sum + h.weight, 0);
    let roll = Math.random() * total;
    for (const h of HAUNTINGS) {
      roll -= h.weight;
      if (roll <= 0) {
        // clip still in flight (very early in a run): come back for it shortly
        // rather than burning the event on silence
        if (!this.buffers.has(h.name)) {
          this.prepareSfx();
          this.hauntTimer = 5;
          return;
        }
        this.playHaunt(h.name, h.place());
        return;
      }
    }
  }

  // ---------------------------------------------------------- ambience

  private buildAmbience(id: AmbienceId): GainNode {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.ambBus);

    const noiseBuf = makeBuffer(ctx, 3, (d) => {
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    });
    const noiseSrc = () => {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      s.loop = true;
      s.start();
      return s;
    };

    switch (id) {
      case 'hum': {
        // fluorescent buzz: 120 Hz + harmonics, slightly detuned
        for (const [f, v] of [[120, 0.05], [122, 0.025], [240, 0.018], [361, 0.008]] as const) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          const g = ctx.createGain();
          g.gain.value = v;
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 900;
          o.connect(lp); lp.connect(g); g.connect(out);
          o.start();
        }
        const n = noiseSrc();
        const nf = ctx.createBiquadFilter();
        nf.type = 'bandpass'; nf.frequency.value = 1900; nf.Q.value = 1.2;
        const ng = ctx.createGain(); ng.gain.value = 0.012;
        n.connect(nf); nf.connect(ng); ng.connect(out);
        break;
      }
      case 'garage': {
        // extractor fans somewhere you can't see, running on a slab that
        // carries every one of them to you at once
        const n = noiseSrc();
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 240;
        const ng = ctx.createGain(); ng.gain.value = 0.13;
        n.connect(lp); lp.connect(ng); ng.connect(out);
        for (const [f, v] of [[57, 0.055], [58.6, 0.04], [114, 0.02]] as const) {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = f;
          const g = ctx.createGain(); g.gain.value = v;
          o.connect(g); g.connect(out);
          o.start();
        }
        // and, very faintly, the strip lights
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = 120;
        const olp = ctx.createBiquadFilter();
        olp.type = 'lowpass'; olp.frequency.value = 700;
        const og = ctx.createGain(); og.gain.value = 0.016;
        o.connect(olp); olp.connect(og); og.connect(out);
        o.start();
        break;
      }
      case 'wrong': {
        // the lobby's hum, a quarter-tone out and beating against itself
        for (const [f, v] of [[120, 0.045], [118.3, 0.04], [239, 0.016], [61, 0.05]] as const) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 620;
          const g = ctx.createGain();
          g.gain.value = v;
          o.connect(lp); lp.connect(g); g.connect(out);
          o.start();
        }
        const n = noiseSrc();
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.8;
        const ng = ctx.createGain(); ng.gain.value = 0.02;
        // it breathes, which fluorescent light does not
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.11;
        const lfoG = ctx.createGain(); lfoG.gain.value = 0.016;
        lfo.connect(lfoG); lfoG.connect(ng.gain);
        lfo.start();
        n.connect(bp); bp.connect(ng); ng.connect(out);
        break;
      }
      case 'tunnel': {
        const n = noiseSrc();
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 130;
        const g = ctx.createGain(); g.gain.value = 0.22;
        n.connect(lp); lp.connect(g); g.connect(out);
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = 47;
        const og = ctx.createGain(); og.gain.value = 0.04;
        o.connect(og); og.connect(out);
        o.start();
        break;
      }
      case 'pool': {
        const n = noiseSrc();
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.7;
        const g = ctx.createGain(); g.gain.value = 0.1;
        // slow lapping LFO
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.16;
        const lfoG = ctx.createGain(); lfoG.gain.value = 0.05;
        lfo.connect(lfoG); lfoG.connect(g.gain);
        lfo.start();
        n.connect(bp); bp.connect(g); g.connect(out);
        break;
      }
      case 'deep': {
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = 34;
        const g = ctx.createGain(); g.gain.value = 0.16;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.07;
        const lfoG = ctx.createGain(); lfoG.gain.value = 0.07;
        lfo.connect(lfoG); lfoG.connect(g.gain);
        o.connect(g); g.connect(out);
        o.start(); lfo.start();
        const n = noiseSrc();
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 90;
        const ng = ctx.createGain(); ng.gain.value = 0.1;
        n.connect(lp); lp.connect(ng); ng.connect(out);
        break;
      }
    }
    return out;
  }

  setAmbience(id: AmbienceId): void {
    if (this.currentAmbience === id) return;
    this.currentAmbience = id;
    if (!this.ambGraphs.has(id)) this.ambGraphs.set(id, this.buildAmbience(id));
    const t = this.ctx.currentTime;
    for (const [k, g] of this.ambGraphs) {
      g.gain.setTargetAtTime(k === id ? 1 : 0, t, 2.2);
    }
  }

  /** occasional drips for tunnel/pool ambiences */
  update(dt: number): void {
    const a = this.currentAmbience;
    if (a === 'tunnel' || a === 'pool' || a === 'deep' || a === 'garage' || a === 'wrong') {
      this.dripTimer -= dt;
      if (this.dripTimer <= 0) {
        this.dripTimer = 1.5 + Math.random() * 6;
        this.playSfx('drip', 0.12 + Math.random() * 0.2, 0.4);
      }
    }
    this.scheduleHaunting(dt);
  }

  setMuffled(underwater: boolean): void {
    if (this.muffled === underwater) return;
    this.muffled = underwater;
    // underwater: duck the high-frequency-rich sfx bus
    this.sfxBus.gain.setTargetAtTime(underwater ? 0.4 : 1, this.ctx.currentTime, 0.15);
    this.ambBus.gain.setTargetAtTime(underwater ? 0.25 : 0.8, this.ctx.currentTime, 0.15);
    this.hauntBus.gain.setTargetAtTime(underwater ? 0.35 : 1, this.ctx.currentTime, 0.15);
  }
}
