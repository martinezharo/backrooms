// Almost everything you hear is synthesized at runtime. SFX are pre-rendered
// into AudioBuffers; ambiences are live node graphs crossfaded per biome; enemy
// cues are one-shot buffers placed on PositionalAudio at AI moments.
//
// The exception is the hauntings (see clips/CREDITS.md): a scream or a whisper
// has to be a recording of an actual throat — synthesis gets you a synthesizer
// pretending, and you hear the difference immediately.

import * as THREE from 'three';

import dragScrapeUrl from './clips/drag_scrape.mp3?url';
import earWhisperUrl from './clips/ear_whisper.mp3?url';
import farBangUrl from './clips/far_bang.mp3?url';
import farScreamUrl from './clips/far_scream.mp3?url';
import metalFallUrl from './clips/metal_fall.mp3?url';

type AmbienceId = 'hum' | 'tunnel' | 'pool' | 'deep';

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
  private hauntTimer = 25 + Math.random() * 35;
  private dread = 0;
  private sprayNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
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

    B.set('step_carpet', makeBuffer(ctx, 0.12, (d, sr) => {
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * envExp(i, sr, 55) * 0.5;
      lowpass(d, 0.12);
    }));
    B.set('step_hard', makeBuffer(ctx, 0.1, (d, sr) => {
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * envExp(i, sr, 70) * 0.7;
      lowpass(d, 0.3);
    }));
    B.set('step_water', makeBuffer(ctx, 0.25, (d, sr) => {
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * envExp(i, sr, 22) * 0.55;
      lowpass(d, 0.2);
    }));
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
    B.set('glassBreak', makeBuffer(ctx, 0.6, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let v = 0;
        for (const f of [2310, 3170, 4730, 6390]) {
          v += Math.sin(2 * Math.PI * f * t + Math.sin(t * 80) * 4);
        }
        d[i] = (v * 0.18 + (Math.random() - 0.5) * 0.7) * envExp(i, sr, 12);
      }
    }));
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
    const buf = this.buffers.get(name);
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

  footstep(surface: 'carpet' | 'hard' | 'water'): void {
    this.playSfx(`step_${surface}`, 0.5, 0.18);
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
    if (a === 'tunnel' || a === 'pool' || a === 'deep') {
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
