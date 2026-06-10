// Procedural drone score + tension layer + heartbeat tied to danger level.

import { AudioEngine } from './AudioEngine';

export class Music {
  private ctx: AudioContext;
  private out: GainNode;
  private tensionGain: GainNode | null = null;
  private heartGain: GainNode | null = null;
  private started = false;
  private tension = 0;
  private nextBeat = 0;

  constructor(audio: AudioEngine) {
    this.ctx = audio.getContext();
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.5;
    this.out.connect(audio.getMusicDestination());
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const ctx = this.ctx;

    // base drone: detuned low saws through a dark filter
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 160;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.06;
    droneFilter.connect(droneGain);
    droneGain.connect(this.out);
    for (const f of [55, 55.6, 82.4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(droneFilter);
      o.start();
    }
    // slow swell LFO
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.025;
    lfo.connect(lfoG);
    lfoG.connect(droneGain.gain);
    lfo.start();

    // tension layer: dissonant minor-second cluster, gain driven by danger
    this.tensionGain = ctx.createGain();
    this.tensionGain.gain.value = 0;
    this.tensionGain.connect(this.out);
    for (const [f, v] of [[220, 0.04], [233.1, 0.04], [466.2, 0.015]] as const) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = v;
      const trem = ctx.createOscillator();
      trem.frequency.value = 4.3;
      const tremG = ctx.createGain();
      tremG.gain.value = v * 0.5;
      trem.connect(tremG);
      tremG.connect(g.gain);
      o.connect(g);
      g.connect(this.tensionGain);
      o.start();
      trem.start();
    }

    this.heartGain = ctx.createGain();
    this.heartGain.gain.value = 0;
    this.heartGain.connect(this.out);
  }

  /** Momentary surge — used when an enemy commits to an attack. */
  spike(): void {
    this.tension = Math.max(this.tension, 0.85);
  }

  setTension(t: number): void {
    this.tension += (Math.max(0, Math.min(1, t)) - this.tension) * 0.05;
    if (!this.started || !this.tensionGain || !this.heartGain) return;
    const now = this.ctx.currentTime;
    this.tensionGain.gain.setTargetAtTime(this.tension * 0.9, now, 0.6);
    this.heartGain.gain.setTargetAtTime(this.tension > 0.25 ? 0.5 + this.tension * 0.5 : 0, now, 0.4);
  }

  /** call every frame; schedules heartbeat thumps at a tension-driven rate */
  update(): void {
    if (!this.started || !this.heartGain || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (now < this.nextBeat) return;
    const bpm = 52 + this.tension * 78;
    this.nextBeat = now + 60 / bpm;
    // lub-dub: two filtered sine thumps
    for (const [delay, vol] of [[0, 1], [0.16, 0.6]] as const) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(58, now + delay);
      o.frequency.exponentialRampToValueAtTime(34, now + delay + 0.12);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, now + delay);
      g.gain.linearRampToValueAtTime(0.5 * vol, now + delay + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.22);
      o.connect(g);
      g.connect(this.heartGain);
      o.start(now + delay);
      o.stop(now + delay + 0.3);
    }
  }
}
