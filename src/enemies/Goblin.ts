// GOBLIN — tiny neutral nuisance. It never walks toward the player unless
// provoked. At middle distance it waves, cackles or ducks behind cover; up
// close it bolts. Hit one and the joke is over. Hug one and it is yours.

import * as THREE from 'three';
import { Enemy, EnemyContext } from './Enemy';
import { limb, Limb, skinMaterial } from './anatomy';

type GoblinMood = 'idle' | 'wave' | 'cackle' | 'hide' | 'peek' | 'run' | 'angry';

const FLEE_DISTANCE = 4.4;
const SAFE_DISTANCE = 7.1;
const TEASE_MIN = 6.2;
const TEASE_MAX = 12.5;

function std(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.88, ...opts });
}

export class Goblin extends Enemy {
  // The audio system only knows the original voices. Spawner serializes Goblins
  // with their own save id, so borrowing this voice id cannot turn a saved
  // friend into the wrong species.
  readonly typeName = 'GOBLIN';
  readonly voiceId = 'partygoer' as const;

  private armL!: Limb;
  private armR!: Limb;
  private legL!: Limb;
  private legR!: Limb;
  private earL = new THREE.Group();
  private earR = new THREE.Group();
  private jaw = new THREE.Group();
  private pupils: THREE.Mesh[] = [];
  private eyelids: THREE.Mesh[] = [];
  private dagger = new THREE.Group();

  private mood: GoblinMood = 'idle';
  private moodTimer = 0.8 + Math.random() * 1.5;
  private blinkTimer = 1.5 + Math.random() * 3.5;
  private blink = 0;
  private earTimer = 0.8 + Math.random() * 2.5;
  private earKick = 0;
  private angry = false;
  private angerCuePending = false;
  private hideTargetFresh = false;
  private personality = Math.random();

  get isAngry(): boolean { return this.angry; }

  constructor() {
    super();
    this.hp = 32;
    this.speed = 4.85;
    this.damage = 8;
    this.attackRange = 1.02;
    this.attackCooldown = 0.85;
    this.aggroRange = 30;
    this.radius = 0.22;
    this.bodyHeight = 0.68;

    // These values are reused by pickStalkPoint() when the goblin decides that
    // the funniest response is to vanish behind a wall.
    this.stalkRange = 30;
    this.stalkDistMin = TEASE_MIN;
    this.stalkDistMax = 8.8;
    this.freezeWhenSeen = false;
  }

  takeDamage(amount: number, knockDir?: THREE.Vector3): void {
    super.takeDamage(amount, knockDir);
    if (!this.alive || this.befriended) return;
    this.angry = true;
    this.angerCuePending = true;
    this.mood = 'angry';
    this.moodTimer = 999;
    this.state = 'chase';
    this.speedMult = 1.05;
    this.stalkPoint = null;
  }

  befriend(): void {
    super.befriend();
    this.angry = false;
    this.angerCuePending = false;
    this.mood = 'idle';
    this.moodTimer = 1.2;
    this.mesh.rotation.x = 0;
  }

  protected buildBody(): void {
    const skin = skinMaterial({
      base: '#6f9342',
      mottle: '#384d24',
      veins: true,
      seed: 47,
      roughness: 0.82,
    });
    const skinDark = skinMaterial({
      base: '#587735',
      mottle: '#2f4221',
      seed: 51,
      roughness: 0.9,
    });
    const cloth = std(0x55402a);
    const clothDark = std(0x2a241b);
    const leather = std(0x3b2518);
    const metal = std(0x79756b, { metalness: 0.65, roughness: 0.5 });

    // Small pear-shaped torso. The head is deliberately enormous relative to it.
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 9), skin);
    belly.scale.set(0.95, 1.2, 0.82);
    belly.position.set(0, 0.38, 0);
    this.mesh.add(belly);

    const vest = new THREE.Mesh(new THREE.SphereGeometry(0.142, 12, 8), cloth);
    vest.scale.set(1, 0.65, 0.88);
    vest.position.set(0, 0.43, -0.005);
    this.mesh.add(vest);

    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.017, 6, 14), leather);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.32;
    this.mesh.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.047, 0.036, 0.018), metal);
    buckle.position.set(0, 0.32, 0.125);
    this.mesh.add(buckle);

    // Head tracking is inherited from Enemy; all facial bits and ears live here.
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.58, 0.015);
    this.mesh.add(pivot);
    this.headPivot = pivot;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.175, 14, 11), skin);
    head.scale.set(1.08, 0.9, 0.93);
    pivot.add(head);

    // Pointed ears: cones laid sideways, with a darker inner ear nested inside.
    const makeEar = (side: -1 | 1): THREE.Group => {
      const g = new THREE.Group();
      g.position.set(side * 0.145, 0.025, -0.005);
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.068, 0.235, 6), skinDark);
      outer.rotation.z = side * -Math.PI / 2;
      outer.position.x = side * 0.085;
      g.add(outer);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.034, 0.16, 6), std(0x886447));
      inner.rotation.z = side * -Math.PI / 2;
      inner.position.set(side * 0.083, 0, 0.018);
      g.add(inner);
      pivot.add(g);
      return g;
    };
    this.earL = makeEar(-1);
    this.earR = makeEar(1);

    // Bulging amber eyes with tiny pupils. Eyelids squash them during blinks.
    const eyeWhite = std(0xcbbd72, { emissive: 0x302208, emissiveIntensity: 0.45, roughness: 0.4 });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x090906 });
    const lidMat = skinDark;
    for (const sx of [-0.067, 0.067]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.047, 9, 7), eyeWhite);
      eye.scale.set(0.88, 1.05, 0.7);
      eye.position.set(sx, 0.035, 0.145);
      pivot.add(eye);

      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.016, 7, 5), pupilMat);
      pupil.position.set(sx, 0.035, 0.181);
      pivot.add(pupil);
      this.pupils.push(pupil);

      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.051, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), lidMat);
      lid.scale.set(0.9, 0.15, 0.73);
      lid.position.set(sx, 0.069, 0.146);
      lid.rotation.x = Math.PI;
      pivot.add(lid);
      this.eyelids.push(lid);
    }

    // Long crooked nose, two tiny lower fangs and an animated jaw.
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.044, 0.135, 7), skinDark);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0.012, -0.012, 0.205);
    pivot.add(nose);

    this.jaw.position.set(0, -0.088, 0.105);
    const jawMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 9, 7), skin);
    jawMesh.scale.set(0.95, 0.38, 0.72);
    this.jaw.add(jawMesh);
    const toothMat = std(0xe4d7ad);
    for (const sx of [-0.038, 0.038]) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.055, 5), toothMat);
      fang.position.set(sx, -0.012, 0.073);
      this.jaw.add(fang);
    }
    pivot.add(this.jaw);

    // Jointed arms and legs, exaggerated hands and feet for readable animation.
    const makeArm = (side: -1 | 1): Limb => {
      const l = limb([
        { len: 0.14, r0: 0.031, r1: 0.026 },
        { len: 0.13, r0: 0.025, r1: 0.019 },
      ], skin);
      l.root.position.set(side * 0.145, 0.47, 0);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.038, 7, 6), skinDark);
      hand.scale.set(1, 0.75, 0.9);
      l.end.add(hand);
      this.mesh.add(l.root);
      return l;
    };
    this.armL = makeArm(-1);
    this.armR = makeArm(1);

    const makeLeg = (side: -1 | 1): Limb => {
      const l = limb([
        { len: 0.15, r0: 0.039, r1: 0.032 },
        { len: 0.14, r0: 0.031, r1: 0.024 },
      ], skinDark);
      l.root.position.set(side * 0.075, 0.28, 0);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.038, 0.13), clothDark);
      foot.position.set(0, -0.018, 0.035);
      l.end.add(foot);
      this.mesh.add(l.root);
      return l;
    };
    this.legL = makeLeg(-1);
    this.legR = makeLeg(1);

    // Tiny rusty dagger. Normally it hangs at his side; anger/defence turns it
    // into a very sincere little problem.
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.18, 4), metal);
    blade.rotation.z = Math.PI;
    blade.position.y = -0.105;
    this.dagger.add(blade);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.018, 0.022), metal);
    guard.position.y = -0.018;
    this.dagger.add(guard);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.08, 6), leather);
    grip.position.y = 0.035;
    this.dagger.add(grip);
    this.dagger.position.set(0, -0.04, 0.015);
    this.dagger.rotation.z = 0.15;
    this.armR.end.add(this.dagger);
  }

  protected think(dt: number, ctx: EnemyContext, distToPlayer: number): void {
    this.frozen = false;

    if (this.angry) {
      this.state = 'chase';
      this.speedMult = 1.05;
      this.mood = 'angry';
      if (this.angerCuePending) {
        ctx.notifySound?.(this, 1);
        this.angerCuePending = false;
      }
      return;
    }

    this.speedMult = 1;
    const canSeePlayer = !ctx.world.lineBlocked(
      this.position.x,
      this.position.z,
      ctx.player.position.x,
      ctx.player.position.z,
    );

    // Personal-space violation: immediately run directly away. It keeps running
    // until it has rebuilt a generous buffer, so repeatedly rushing it reads as
    // a chase rather than nervous one-step shuffles.
    if (distToPlayer < FLEE_DISTANCE || (this.state === 'flee' && distToPlayer < SAFE_DISTANCE)) {
      this.state = 'flee';
      this.mood = 'run';
      this.moodTimer = 0.45;
      this.stalkPoint = null;
      return;
    }

    if (this.state === 'flee') {
      this.state = 'stalk';
      this.mood = 'peek';
      this.moodTimer = 0.7 + Math.random() * 0.7;
    }

    // Goblins do not wander toward the player. Neutral behavior always stays in
    // the base class's stalk lane, where frozen=true means stand and tease.
    this.state = 'stalk';

    if (!canSeePlayer) {
      this.frozen = true;
      this.mood = 'hide';
      this.moodTimer = Math.max(this.moodTimer, 0.6);
      return;
    }

    const inTeaseBand = distToPlayer >= TEASE_MIN && distToPlayer <= TEASE_MAX;
    if (!inTeaseBand) {
      this.frozen = true;
      this.mood = distToPlayer < TEASE_MIN ? 'peek' : 'idle';
      this.moodTimer = Math.min(this.moodTimer, 1.2);
      return;
    }

    // If the last joke was hiding, finish the retreat before choosing another.
    if (this.mood === 'hide' && this.stalkPoint && !this.hideTargetFresh) {
      if (this.position.distanceTo(this.stalkPoint) > 0.9) {
        this.frozen = false;
        return;
      }
      this.stalkPoint = null;
      this.mood = 'peek';
      this.moodTimer = 0.65 + Math.random() * 0.5;
    }

    this.moodTimer -= dt;
    if (this.moodTimer <= 0) this.chooseTease(ctx);

    if (this.mood === 'hide') {
      // pickStalkPoint(retreat=true) strongly prefers farther, covered spots.
      // Calling it only once matters: otherwise the target jitters every frame.
      if (this.hideTargetFresh || !this.stalkPoint) {
        this.pickStalkPoint(ctx, true);
        this.hideTargetFresh = false;
      }
      this.frozen = !this.stalkPoint;
    } else {
      this.frozen = true;
    }
  }

  private chooseTease(ctx: EnemyContext): void {
    const r = Math.random();
    // Each instance has a mild personality bias, but none are deterministic.
    const hideCut = 0.18 + this.personality * 0.16;
    const cackleCut = hideCut + 0.28 + (1 - this.personality) * 0.12;
    if (r < hideCut) {
      this.mood = 'hide';
      this.hideTargetFresh = true;
      this.stalkPoint = null;
      this.moodTimer = 2.2 + Math.random() * 2;
    } else if (r < cackleCut) {
      this.mood = 'cackle';
      this.moodTimer = 1.5 + Math.random() * 1.2;
      ctx.notifySound?.(this, 0.4);
    } else if (r < 0.88) {
      this.mood = 'wave';
      this.moodTimer = 1.4 + Math.random() * 1.4;
    } else {
      this.mood = 'peek';
      this.moodTimer = 0.7 + Math.random() * 0.8;
    }
  }

  protected animate(dt: number, moveSpeed: number, ctx: EnemyContext): void {
    const t = ctx.time;
    const moving = Math.min(1, moveSpeed / Math.max(0.1, this.speed));
    const ph = this.walkPhase * 1.55;
    const run = this.mood === 'run' || this.mood === 'angry' || moving > 0.65;

    // Reset toward a neutral pose first, then layer the current animation.
    const ease = Math.min(1, dt * 12);
    const pose = (joint: THREE.Group, axis: 'x' | 'y' | 'z', target: number): void => {
      joint.rotation[axis] += (target - joint.rotation[axis]) * ease;
    };

    const stride = run ? 0.95 : 0.48;
    pose(this.legL.joints[0], 'x', Math.sin(ph) * stride * moving);
    pose(this.legR.joints[0], 'x', -Math.sin(ph) * stride * moving);
    pose(this.legL.joints[1], 'x', Math.max(0, -Math.sin(ph)) * 0.75 * moving);
    pose(this.legR.joints[1], 'x', Math.max(0, Math.sin(ph)) * 0.75 * moving);
    pose(this.armL.joints[0], 'x', -Math.sin(ph) * 0.42 * moving);
    pose(this.armR.joints[0], 'x', Math.sin(ph) * 0.42 * moving);
    pose(this.armL.joints[0], 'z', 0);
    pose(this.armR.joints[0], 'z', 0);
    pose(this.armL.joints[1], 'x', 0.12);
    pose(this.armR.joints[1], 'x', 0.12);
    pose(this.armL.joints[1], 'z', 0);
    pose(this.armR.joints[1], 'z', 0);

    let bodyLean = run && moving > 0.1 ? 0.2 : 0;
    let bodyCrouch = 0;
    let jawOpen = 0;

    if (this.mood === 'wave' && !this.befriended) {
      pose(this.armR.joints[0], 'z', -1.95);
      pose(this.armR.joints[0], 'x', -0.2);
      pose(this.armR.joints[1], 'z', 1.4 + Math.sin(t * 10) * 0.42);
      pose(this.armL.joints[0], 'z', 0.18);
      this.headPivot!.rotation.z += (Math.sin(t * 2.7) * 0.11 - this.headPivot!.rotation.z) * Math.min(1, dt * 5);
    } else if (this.mood === 'cackle' && !this.befriended) {
      const shake = Math.sin(t * 19) * 0.13;
      pose(this.armL.joints[0], 'z', 0.72 + shake);
      pose(this.armR.joints[0], 'z', -0.72 - shake);
      pose(this.armL.joints[1], 'x', -1.05);
      pose(this.armR.joints[1], 'x', -1.05);
      bodyLean = -0.08 + Math.abs(Math.sin(t * 11)) * 0.06;
      jawOpen = 0.8 + Math.sin(t * 14) * 0.18;
    } else if (this.mood === 'hide') {
      bodyCrouch = 0.075;
      pose(this.armL.joints[0], 'z', 0.65);
      pose(this.armR.joints[0], 'z', -0.65);
      pose(this.armL.joints[1], 'x', -1.2);
      pose(this.armR.joints[1], 'x', -1.2);
    } else if (this.mood === 'peek') {
      bodyCrouch = 0.025;
      this.headPivot!.rotation.z += (0.28 * Math.sin(t * 2.4) - this.headPivot!.rotation.z) * Math.min(1, dt * 5);
    }

    // A pulse is generated by both hostile and companion attacks. The right arm
    // owns the dagger, so the same readable slash works on either side of friendship.
    if (this.attackPulse > 0) {
      const slash = Math.sin((1 - this.attackPulse) * Math.PI);
      pose(this.armR.joints[0], 'x', -1.8 + slash * 2.3);
      pose(this.armR.joints[0], 'z', -0.55 + slash * 0.9);
      pose(this.armR.joints[1], 'x', -0.9);
      bodyLean = 0.28;
      jawOpen = Math.max(jawOpen, 0.45);
    }

    // Tiny breathing/bobbing keeps a stationary teaser from becoming a statue.
    const breathe = Math.sin(t * 3.1 + this.personality * 4) * 0.006;
    this.mesh.position.y = this.position.y - bodyCrouch + breathe + (moving > 0.1 ? Math.abs(Math.sin(ph)) * 0.018 : 0);
    this.mesh.rotation.x += (bodyLean - this.mesh.rotation.x) * Math.min(1, dt * 7);

    // Ears have their own little nervous system.
    this.earTimer -= dt;
    this.earKick = Math.max(0, this.earKick - dt * 5);
    if (this.earTimer <= 0) {
      this.earKick = 1;
      this.earTimer = 0.7 + Math.random() * 3.5;
    }
    const earBounce = Math.sin(ph * 1.3) * moving * 0.12;
    this.earL.rotation.z = earBounce + this.earKick * 0.18;
    this.earR.rotation.z = -earBounce - this.earKick * 0.18;

    // Blink in abrupt goblin snaps, not soft human eyelids.
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 0.11;
      this.blinkTimer = 1.6 + Math.random() * 4.2;
    }
    this.blink = Math.max(0, this.blink - dt);
    const blinkScale = this.blink > 0 ? 0.12 : 1;
    for (const lid of this.eyelids) lid.scale.y = blinkScale === 1 ? 0.15 : 1.25;
    for (const pupil of this.pupils) pupil.scale.y = blinkScale;

    this.jaw.rotation.x += (jawOpen * 0.5 - this.jaw.rotation.x) * Math.min(1, dt * 14);
  }
}
