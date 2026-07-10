// The four Backrooms entities. Bodies are procedural — organic lathe shapes,
// jointed two-segment limbs, canvas skin textures — and animated by movement
// speed, AI state, the shared head-tracking pivot and the twitch driver.

import * as THREE from 'three';
import { Enemy, EnemyContext } from './Enemy';
import { latheGeo, limb, Limb, mergeStatic, skinBumpTexture, skinMaterial, xform } from './anatomy';

function std(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });
}

// ---------------------------------------------------------------------------
// SMILER — a smear of darkness wearing a face. Fast in the dark, flees light.
// The shadow is three nested translucent shells that slowly writhe; the grin
// widens when you look at it.
// ---------------------------------------------------------------------------
export class Smiler extends Enemy {
  readonly typeName = 'SMILER';
  readonly voiceId = 'smiler' as const;

  private shells: THREE.Mesh[] = [];
  private shellMats: THREE.MeshBasicMaterial[] = [];
  private shellBase: number[] = [];
  private eyes: THREE.Mesh[] = [];
  private lowerJaw = new THREE.Group();
  private grinOpen = 0;
  private blinkTimer = 2;
  private blink = 0;
  private litNow = false;

  constructor() {
    super();
    this.hp = 40;
    this.speed = 4.4;
    this.damage = 18;
    this.attackRange = 1.6;
    this.attackCooldown = 1.1;
    this.aggroRange = 19;
    // lurks far out and only works up the nerve to attack from darkness
    this.stalkRange = 26;
    this.stalkDistMin = 10;
    this.stalkDistMax = 16;
    this.patience = 1.3;
  }

  /** it never commits while standing in the light */
  protected boldnessGainMult(ctx: EnemyContext): number {
    return ctx.lighting.isLitArea(this.position, ctx.time) ? 0 : 1;
  }

  befriend(): void {
    super.befriend();
    this.litNow = false; // think() no longer runs; don't stay thinned out
  }

  protected buildBody(): void {
    // nested shadow shells, outer ones barely-there
    const profile: [number, number][] = [
      [0.04, 0], [0.18, 0.12], [0.3, 0.55], [0.36, 1.0], [0.33, 1.45], [0.2, 1.78], [0.02, 1.95],
    ];
    const specs: [number, number, boolean][] = [[1, 0.92, true], [1.28, 0.4, false], [1.6, 0.18, false]];
    for (const [scale, opacity, depthWrite] of specs) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x020202, transparent: true, opacity, depthWrite });
      const shell = new THREE.Mesh(latheGeo(profile), mat);
      shell.scale.set(scale, 1, scale);
      this.mesh.add(shell);
      this.shells.push(shell);
      this.shellMats.push(mat);
      this.shellBase.push(opacity);
    }

    // the face rides the tracking pivot — it finds you even when the body doesn't
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.5, 0.08);
    this.mesh.add(pivot);
    this.headPivot = pivot;

    const glow = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const halo = new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.22, depthWrite: false });
    const dark = new THREE.MeshBasicMaterial({ color: 0x050505 });
    for (const sx of [-0.11, 0.11]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), glow);
      eye.position.set(sx, 0.1, 0.24);
      pivot.add(eye);
      this.eyes.push(eye);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.078, 8, 8), halo);
      h.position.copy(eye.position);
      pivot.add(h);
      // pupils sit slightly off-centre — wrong-looking on purpose
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), dark);
      pupil.position.set(sx + (sx > 0 ? 0.008 : -0.013), 0.107, 0.283);
      pivot.add(pupil);
    }

    // the grin: two curved rows of irregular teeth; the lower row can part
    const teethMat = new THREE.MeshBasicMaterial({ color: 0xf2f2ea });
    const mkArc = (pointDown: boolean): THREE.Mesh => {
      const geos: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 8 - 0.5) * 1.9;
        const len = 0.045 + Math.random() * 0.05;
        const g = new THREE.ConeGeometry(0.011 + Math.random() * 0.012, len, 5);
        xform(
          g,
          Math.sin(a) * 0.21,
          -0.17 + (1 - Math.cos(a)) * 0.06 + (pointDown ? 0.02 : -0.02),
          0.21 + Math.cos(a) * 0.04,
          (pointDown ? Math.PI : 0) + (Math.random() - 0.5) * 0.35,
          0,
          -a * 0.3,
        );
        geos.push(g);
      }
      return mergeStatic(geos, teethMat);
    };
    pivot.add(mkArc(true)); // upper row hangs down
    this.lowerJaw.add(mkArc(false)); // lower row points up, parts when watched
    pivot.add(this.lowerJaw);
  }

  protected think(dt: number, ctx: EnemyContext, distToPlayer: number): void {
    const inBeam = ctx.lighting.inFlashlightBeam(this.position.clone().setY(this.position.y + 1.4));
    const lit = inBeam || ctx.lighting.isLitArea(this.position, ctx.time);
    this.litNow = lit;
    if (inBeam && distToPlayer < 16) {
      this.state = 'flee';
      this.speedMult = 1.25;
      return;
    }
    if (this.state === 'flee') this.state = distToPlayer < this.stalkRange ? 'stalk' : 'wander';
    this.speedMult = lit ? 0.35 : 1;
    super.think(dt, ctx, distToPlayer);
  }

  protected animate(dt: number, moveSpeed: number, ctx: EnemyContext): void {
    const t = ctx.time;
    for (let i = 0; i < this.shells.length; i++) {
      const sh = this.shells[i];
      sh.rotation.y += dt * (i % 2 === 0 ? 0.35 : -0.5) * (1 + this.twitch * 3);
      const base = i === 0 ? 1 : i === 1 ? 1.28 : 1.6;
      const pulse = 1 + Math.sin(t * (1.3 + i * 0.7) + i * 2.1) * 0.05;
      sh.scale.set(base * pulse, 1 + Math.sin(t * 0.9 + i) * 0.02, base * pulse);
      // it thins out in the light
      const target = this.shellBase[i] * (this.litNow ? 0.3 : 1);
      this.shellMats[i].opacity += (target - this.shellMats[i].opacity) * Math.min(1, dt * 3);
    }

    // the grin widens when you look at it
    const watched = (this.state === 'stalk' && this.frozen) || this.state === 'chase';
    this.grinOpen += ((watched ? 1 : 0) - this.grinOpen) * Math.min(1, dt * 1.8);
    this.lowerJaw.rotation.x = this.grinOpen * 0.5;
    this.lowerJaw.position.y = -this.grinOpen * 0.04;

    // rare mechanical blink
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 0.08;
      this.blinkTimer = 2 + Math.random() * 5;
    }
    this.blink = Math.max(0, this.blink - dt);
    for (const e of this.eyes) e.scale.y = this.blink > 0 ? 0.07 : 1;
    void moveSpeed;
  }

  protected canSwim(): boolean { return true; }
}

// ---------------------------------------------------------------------------
// SKIN-STEALER — an emaciated thing wearing someone. Concave belly, visible
// ribs, sagging skin, a jaw that hangs open wider as it works up the nerve.
// ---------------------------------------------------------------------------
export class SkinStealer extends Enemy {
  readonly typeName = 'SKIN-STEALER';
  readonly voiceId = 'stealer' as const;

  private armL!: Limb;
  private armR!: Limb;
  private legL!: Limb;
  private legR!: Limb;
  private jaw = new THREE.Group();

  constructor() {
    super();
    this.hp = 130;
    this.speed = 1.55;
    this.damage = 24;
    this.attackRange = 1.9;
    this.attackCooldown = 1.6;
    this.aggroRange = 14;
    // corner ambusher: shadows you from close cover, strikes only point-blank
    this.stalkDistMin = 7;
    this.stalkDistMax = 12;
    this.patience = 0.6;
    this.commitMaxDist = 9;
    this.coverBonus = 8;
  }

  protected buildBody(): void {
    const skin = skinMaterial({ base: '#cfbb9b', mottle: '#8d7560', veins: true, roughness: 0.6 });

    // torso with concave belly + rib ridges, merged into one draw call
    const geos: THREE.BufferGeometry[] = [
      latheGeo([
        [0.09, 0.55], [0.17, 0.72], [0.145, 0.95], [0.16, 1.1],
        [0.22, 1.3], [0.24, 1.42], [0.15, 1.55], [0.08, 1.64],
      ]),
    ];
    for (const y of [1.18, 1.26, 1.34, 1.42]) {
      const r = 0.205 + (1.42 - y) * 0.05;
      geos.push(xform(new THREE.TorusGeometry(r, 0.011, 5, 14), 0, y, 0, Math.PI / 2, 0, 0, 1, 0.82, 1));
    }
    this.mesh.add(mergeStatic(geos, skin));

    // sagging skin flaps
    const flapMat = skinMaterial({ base: '#bfae8d', mottle: '#7d6550', veins: true, roughness: 0.7, seed: 13 });
    flapMat.side = THREE.DoubleSide;
    const flaps: THREE.BufferGeometry[] = [];
    for (const [x, y, ry] of [[-0.12, 0.92, 0.4], [0.1, 0.86, -0.5], [0.02, 1.02, 0.1]] as const) {
      flaps.push(xform(new THREE.PlaneGeometry(0.1, 0.17), x, y, 0.12, 0.4, ry, 0));
    }
    this.mesh.add(mergeStatic(flaps, flapMat));

    // stretched skull on the tracking pivot, deep sockets, pinpoint pupils
    const pivot = new THREE.Group();
    pivot.position.y = 1.66;
    this.mesh.add(pivot);
    this.headPivot = pivot;

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
    skull.scale.set(0.82, 1.35, 0.95);
    skull.position.y = 0.12;
    pivot.add(skull);
    const socketMat = std(0x16100b, { roughness: 1 });
    for (const sx of [-0.055, 0.055]) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), socketMat);
      socket.position.set(sx, 0.16, 0.1);
      pivot.add(socket);
      // pinpoints only visible up close in the dark
      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(0.009, 6, 4),
        new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x713c12, emissiveIntensity: 1.6 }),
      );
      pupil.position.set(sx, 0.16, 0.128);
      pivot.add(pupil);
    }
    const jawMesh = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), skin);
    jawMesh.scale.set(0.75, 0.5, 0.95);
    jawMesh.position.set(0, -0.045, 0.055);
    this.jaw.position.set(0, 0.04, 0.02);
    this.jaw.add(jawMesh);
    pivot.add(this.jaw);

    // two-segment limbs; arms reach to the knees, with crude 3-finger hands
    const mkArm = (sx: number): Limb => {
      const l = limb([{ len: 0.34, r0: 0.052, r1: 0.042 }, { len: 0.36, r0: 0.038, r1: 0.026 }], skin);
      l.root.position.set(sx, 1.48, 0);
      const fingers: THREE.BufferGeometry[] = [];
      for (const fx of [-0.026, 0, 0.026]) {
        fingers.push(xform(new THREE.ConeGeometry(0.011, 0.11, 5), fx, -0.05, 0.01, Math.PI + fx * 3));
      }
      l.end.add(mergeStatic(fingers, skin));
      this.mesh.add(l.root);
      return l;
    };
    this.armL = mkArm(-0.27);
    this.armR = mkArm(0.27);
    const mkLeg = (sx: number): Limb => {
      const l = limb([{ len: 0.38, r0: 0.062, r1: 0.05 }, { len: 0.36, r0: 0.046, r1: 0.034 }], skin);
      l.root.position.set(sx, 0.74, 0);
      this.mesh.add(l.root);
      return l;
    };
    this.legL = mkLeg(-0.12);
    this.legR = mkLeg(0.12);
  }

  protected animate(dt: number, moveSpeed: number, ctx: EnemyContext): void {
    const s = Math.min(1, moveSpeed / this.speed);
    const ph = this.walkPhase;
    // shuffling gait, dragging the right foot
    this.legL.joints[0].rotation.x = Math.sin(ph) * 0.5 * s;
    this.legL.joints[1].rotation.x = -0.15 + Math.max(0, -Math.sin(ph)) * 0.5 * s;
    this.legR.joints[0].rotation.x = -Math.sin(ph + 0.5) * 0.28 * s;
    this.legR.joints[1].rotation.x = -0.15 + Math.max(0, Math.sin(ph + 0.5)) * 0.25 * s;
    // arms hang dead, raise toward you in a chase
    const reach = this.state === 'chase' ? 1 : 0;
    for (const [l, dir] of [[this.armL, 1], [this.armR, -1]] as const) {
      const target = -1.3 * reach + Math.sin(ph + dir) * 0.12 * s;
      l.joints[0].rotation.x += (target - l.joints[0].rotation.x) * Math.min(1, dt * 6);
      l.joints[1].rotation.x = -0.25 - reach * 0.2 + this.twitch * dir * 0.3;
    }
    // slow neck roll — deeply wrong — and spine spasms
    this.headPivot!.rotation.z = Math.sin(ctx.time * 0.4) * 0.3 + this.twitch * 0.35;
    // jaw hangs open with boldness, snaps when it has you
    const close = this.state === 'chase' && this.position.distanceTo(ctx.player.position) < 3;
    this.jaw.rotation.x = 0.12 + this.boldness * 0.4 + (close ? Math.max(0, Math.sin(ctx.time * 11)) * 0.35 : 0);
  }
}

// ---------------------------------------------------------------------------
// HOUND — an eyeless quadruped with skin stretched over the wrong skeleton.
// Trots on jointed legs, sniffs low when idle, raises its hackles on a stalk.
// ---------------------------------------------------------------------------
export class Hound extends Enemy {
  readonly typeName = 'HOUND';
  readonly voiceId = 'hound' as const;

  private legFL!: Limb;
  private legFR!: Limb;
  private legBL!: Limb;
  private legBR!: Limb;
  private neck = new THREE.Group();
  private jaw = new THREE.Group();
  private ridge!: THREE.Mesh;
  /** small per-hound steering offset so packs flank instead of stacking */
  flankAngle = 0;

  constructor() {
    super();
    this.hp = 32;
    this.speed = 5.0;
    this.damage = 8;
    this.attackRange = 1.5;
    this.attackCooldown = 0.9;
    this.aggroRange = 21;
    this.bodyHeight = 0.9;
    // impatient pack hunter — the others join when one commits (see Spawner)
    this.patience = 1.6;
  }

  protected buildBody(): void {
    const hide = skinMaterial({ base: '#9d8f86', mottle: '#5f4a4a', veins: true, roughness: 0.8, seed: 31 });

    // body along +z: hump at the shoulders, sagging belly, drooping tail
    const geos: THREE.BufferGeometry[] = [
      xform(latheGeo([
        [0.02, 0], [0.12, 0.18], [0.17, 0.45], [0.19, 0.62], [0.16, 0.8], [0.13, 1.0],
      ], 12), 0, 0.62, -0.5, Math.PI / 2, 0, 0),
      xform(new THREE.SphereGeometry(0.14, 10, 8), 0, 0.78, 0.3, 0, 0, 0, 1, 0.8, 1.1),
      xform(new THREE.SphereGeometry(0.13, 10, 8), 0, 0.52, -0.05, 0, 0, 0, 1.05, 0.7, 1.5),
      xform(new THREE.ConeGeometry(0.025, 0.34, 6), 0, 0.55, -0.62, -2.2, 0, 0),
    ];
    this.mesh.add(mergeStatic(geos, hide));

    // spine ridge — separate mesh so the hackles can rise
    const ridgeGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      ridgeGeos.push(xform(
        new THREE.ConeGeometry(0.018, 0.07 + (i < 4 ? 0.03 : 0), 5),
        0, 0.84 - Math.abs(i - 3) * 0.012, 0.42 - i * 0.1, -0.25, 0, 0,
      ));
    }
    this.ridge = mergeStatic(ridgeGeos, hide);
    this.mesh.add(this.ridge);

    // neck carries the tracking head; no eyes — just smooth skin and a jaw
    this.neck.position.set(0, 0.74, 0.45);
    this.mesh.add(this.neck);
    const pivot = new THREE.Group();
    this.neck.add(pivot);
    this.headPivot = pivot;

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), hide);
    skull.scale.set(0.78, 0.72, 1.5);
    skull.position.set(0, 0.02, 0.1);
    pivot.add(skull);
    const darkMat = std(0x14100e, { roughness: 1 });
    for (const sx of [-0.022, 0.022]) {
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 4), darkMat);
      nostril.position.set(sx, 0, 0.27);
      pivot.add(nostril);
    }
    const jawMesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), hide);
    jawMesh.scale.set(0.7, 0.45, 1.6);
    jawMesh.position.set(0, -0.02, 0.1);
    this.jaw.position.set(0, -0.05, 0.05);
    this.jaw.add(jawMesh);
    const teeth: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) {
      const sx = (i % 2 === 0 ? -1 : 1) * (0.012 + (i / 8) * 0.03);
      teeth.push(xform(
        new THREE.ConeGeometry(0.008, 0.035 + Math.random() * 0.02, 4),
        sx, 0.015, 0.14 + (i / 8) * 0.06, 0, 0, 0,
      ));
    }
    this.jaw.add(mergeStatic(teeth, std(0xd8d2c0, { roughness: 0.4 })));
    pivot.add(this.jaw);

    const mkLeg = (sx: number, sz: number): Limb => {
      const l = limb([{ len: 0.3, r0: 0.05, r1: 0.038 }, { len: 0.3, r0: 0.034, r1: 0.018 }], hide);
      l.root.position.set(sx, 0.6, sz);
      this.mesh.add(l.root);
      return l;
    };
    this.legFL = mkLeg(-0.14, 0.34);
    this.legFR = mkLeg(0.14, 0.34);
    this.legBL = mkLeg(-0.14, -0.3);
    this.legBR = mkLeg(0.14, -0.3);
  }

  protected animate(dt: number, moveSpeed: number, ctx: EnemyContext): void {
    const s = Math.min(1, moveSpeed / this.speed);
    const ph = this.walkPhase * 1.6;
    // trot: diagonal pairs, knees counter-flexing
    const pairs: [Limb, number][] = [
      [this.legFL, 0], [this.legBR, 0], [this.legFR, Math.PI], [this.legBL, Math.PI],
    ];
    for (const [l, off] of pairs) {
      l.joints[0].rotation.x = Math.sin(ph + off) * 0.65 * s;
      l.joints[1].rotation.x = Math.max(0, Math.sin(ph + off + 0.6)) * 0.6 * s;
    }
    // idle: nose low, sweeping side to side like it's sniffing
    const wandering = this.state === 'wander';
    this.neck.rotation.y += ((wandering ? Math.sin(ctx.time * 0.8) * 0.5 : 0) - this.neck.rotation.y) * Math.min(1, dt * 2);
    this.neck.rotation.x += ((wandering ? 0.35 : 0) - this.neck.rotation.x) * Math.min(1, dt * 2);
    // hackles rise once it has picked you
    const hackles = this.state === 'stalk' || this.state === 'chase' ? 1.15 : 1;
    this.ridge.scale.y += (hackles - this.ridge.scale.y) * Math.min(1, dt * 3);
    // jaw snaps when close
    const close = this.state === 'chase' && this.position.distanceTo(ctx.player.position) < 3;
    this.jaw.rotation.x = (close ? 0.25 + Math.sin(ctx.time * 14) * 0.2 : 0.06) + this.twitch * 0.2;
  }
}

// ---------------------------------------------------------------------------
// PARTYGOER — a wrong birthday clown: stained yellow skin, limbs too long,
// elbows bending the wrong way, a painted smile far too wide, a dead balloon.
// It doesn't hide. It just keeps coming. =)
// ---------------------------------------------------------------------------
export class Partygoer extends Enemy {
  readonly typeName = 'PARTYGOER';
  readonly voiceId = 'partygoer' as const;

  private armL!: Limb;
  private armR!: Limb;
  private legL!: Limb;
  private legR!: Limb;
  private moodTimer = 0;
  private sprinting = false;
  private watched = false;
  private lean = 0;

  constructor() {
    super();
    this.hp = 60;
    this.speed = 2.2;
    this.damage = 15;
    this.attackRange = 1.7;
    this.attackCooldown = 1.2;
    this.aggroRange = 16;
    // doesn't hide — it just keeps ambling closer, then snaps suddenly
    this.freezeWhenSeen = false;
    this.commitThreshold = 0.7;
    this.coverBonus = 0;
    this.stalkDistMin = 6;
    this.stalkDistMax = 10;
  }

  private static faceTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#d9b832';
    ctx.fillRect(0, 0, 256, 256);
    // grime blotches over the paint
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const r = 4 + Math.random() * 18;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(90,70,20,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // hollow eyes — dead black, no highlights
    ctx.fillStyle = '#0a0805';
    for (const ex of [92, 164]) {
      ctx.beginPath();
      ctx.ellipse(ex, 118, 13, 19, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // the smile, painted far too wide
    ctx.strokeStyle = '#120d06';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(128, 140, 62, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();
    // cracked paint
    ctx.strokeStyle = 'rgba(60,45,10,0.55)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 14; i++) {
      let x = 40 + Math.random() * 176;
      let y = 60 + Math.random() * 150;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 4; s++) {
        x += (Math.random() - 0.5) * 26;
        y += (Math.random() - 0.5) * 26;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  protected buildBody(): void {
    const skin = skinMaterial({ base: '#d9b832', mottle: '#7a6a20', streaks: true, roughness: 0.7, seed: 23 });

    // pot-bellied torso
    this.mesh.add(mergeStatic([
      latheGeo([
        [0.13, 0.7], [0.24, 0.85], [0.295, 1.05], [0.27, 1.25], [0.22, 1.42], [0.1, 1.58],
      ]),
    ], skin));

    // oversized head on the tracking pivot
    const pivot = new THREE.Group();
    pivot.position.y = 1.82;
    this.mesh.add(pivot);
    this.headPivot = pivot;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 14, 12),
      new THREE.MeshStandardMaterial({
        map: Partygoer.faceTexture(),
        bumpMap: skinBumpTexture(),
        bumpScale: 0.012,
        roughness: 0.7,
      }),
    );
    head.rotation.y = Math.PI / 2; // face forward (+z)
    pivot.add(head);
    // sunken eye pits aligned with the painted eyes
    const pitMat = std(0x0a0805, { roughness: 1 });
    for (const sx of [-1, 1]) {
      const pit = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), pitMat);
      pit.position.set(sx * 0.175, 0.03, 0.145);
      pivot.add(pit);
    }
    // crooked party hat
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 10), std(0x6a3f7a, { roughness: 0.6 }));
    hat.position.set(0.06, 0.3, 0);
    hat.rotation.z = -0.35;
    pivot.add(hat);

    // limbs too long, elbows bending slightly the wrong way
    const mkArm = (sx: number): Limb => {
      const l = limb([{ len: 0.36, r0: 0.055, r1: 0.045 }, { len: 0.4, r0: 0.04, r1: 0.028 }], skin);
      l.root.position.set(sx, 1.5, 0);
      l.joints[1].rotation.x = 0.12;
      this.mesh.add(l.root);
      return l;
    };
    this.armL = mkArm(-0.3);
    this.armR = mkArm(0.3);
    const mkLeg = (sx: number): Limb => {
      const l = limb([{ len: 0.4, r0: 0.065, r1: 0.052 }, { len: 0.38, r0: 0.048, r1: 0.036 }], skin);
      l.root.position.set(sx, 0.78, 0);
      this.mesh.add(l.root);
      return l;
    };
    this.legL = mkLeg(-0.13);
    this.legR = mkLeg(0.13);

    // a dead balloon drooping below the left hand on a sagging string
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.04, -0.22, 0.03),
      new THREE.Vector3(0.02, -0.45, 0.05),
    ]);
    const string = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.004, 4), std(0xb9b2a4, { roughness: 0.9 }));
    this.armL.end.add(string);
    const balloon = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xa01818, roughness: 0.55, bumpMap: skinBumpTexture(), bumpScale: 0.02 }),
    );
    balloon.scale.set(1, 0.55, 0.85);
    balloon.position.set(0.02, -0.52, 0.05);
    this.armL.end.add(balloon);
  }

  befriend(): void {
    super.befriend();
    // think() no longer runs; settle into a calm amble
    this.sprinting = false;
    this.watched = false;
  }

  protected think(dt: number, ctx: EnemyContext, distToPlayer: number): void {
    super.think(dt, ctx, distToPlayer);
    // erratic mood swings: freeze → stare → sprint
    this.moodTimer -= dt;
    if (this.moodTimer <= 0) {
      this.sprinting = Math.random() < (this.state === 'chase' ? 0.6 : 0.25);
      this.moodTimer = this.sprinting ? 1.2 + Math.random() * 1.6 : 0.7 + Math.random() * 1.8;
    }
    // never sprints while you're watching — until it has committed
    this.watched = this.state === 'stalk' && this.playerCanSeeMe(ctx, distToPlayer);
    if (this.watched) this.sprinting = false;
    this.speedMult = this.sprinting ? 2.9 : (this.state === 'chase' ? 0.25 : 1);
  }

  protected animate(dt: number, moveSpeed: number, _ctx: EnemyContext): void {
    const s = Math.min(1, moveSpeed / (this.speed * 2.5));
    const ph = this.walkPhase * 1.3;
    const flail = this.sprinting ? 3 : 1;
    this.legL.joints[0].rotation.x = Math.sin(ph) * 0.6 * s;
    this.legR.joints[0].rotation.x = -Math.sin(ph) * 0.6 * s;
    this.legL.joints[1].rotation.x = Math.max(0, -Math.sin(ph)) * 0.5 * s;
    this.legR.joints[1].rotation.x = Math.max(0, Math.sin(ph)) * 0.5 * s;
    // arms swing too little when calm; flail when it runs
    this.armL.joints[0].rotation.x = -Math.sin(ph) * 0.14 * flail * s + this.twitch * 0.3;
    this.armR.joints[0].rotation.x = Math.sin(ph) * 0.14 * flail * s - this.twitch * 0.3;
    this.armL.joints[1].rotation.x = 0.12 + (flail > 1 ? Math.sin(ph * 2) * 0.3 * s : 0);
    this.armR.joints[1].rotation.x = 0.12 + (flail > 1 ? -Math.sin(ph * 2) * 0.3 * s : 0);
    // forward lean during a sprint
    const leanTarget = this.sprinting && s > 0.3 ? 0.15 : 0;
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 4);
    this.mesh.rotation.x = this.lean;
    // while you watch it, the head slowly rolls to the side — much too far
    const rollTarget = this.watched ? 1.4 : 0;
    this.headPivot!.rotation.z += (rollTarget - this.headPivot!.rotation.z) * Math.min(1, dt * 0.8);
  }
}
