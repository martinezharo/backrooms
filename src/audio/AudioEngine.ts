// Everything you hear is synthesized at runtime — no audio files.
// SFX are pre-rendered into AudioBuffers; ambiences are live node graphs
// crossfaded per biome; enemy cues are one-shot buffers placed on
// PositionalAudio at AI moments (stalking whispers, chase stingers).

import * as THREE from 'three';

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

export class AudioEngine {
  listener = new THREE.AudioListener();
  private ctx: AudioContext;
  private master: GainNode;
  private sfxBus: GainNode;
  private ambBus: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private ambGraphs = new Map<AmbienceId, GainNode>();
  private currentAmbience: AmbienceId | null = null;
  private dripTimer = 0;
  private sprayNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

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

    this.synthesizeSfx();
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

  // ------------------------------------------------------------- cues

  /** One-shot positional sound attached to an object (enemy), self-removing. */
  playCueAt(name: string, parent: THREE.Object3D, volume = 1, refDist = 4): void {
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
  }

  setMuffled(underwater: boolean): void {
    // underwater: duck the high-frequency-rich sfx bus
    this.sfxBus.gain.setTargetAtTime(underwater ? 0.4 : 1, this.ctx.currentTime, 0.15);
    this.ambBus.gain.setTargetAtTime(underwater ? 0.25 : 0.8, this.ctx.currentTime, 0.15);
  }
}
