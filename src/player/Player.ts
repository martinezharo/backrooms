// First-person controller: capsule vs cell-grid collision, crouch, jump,
// swimming with surface mantle, head-bob.

import * as THREE from 'three';
import {
  CELL, CROUCH_SPEED, EYE_RATIO, GRAVITY, JUMP_VELOCITY,
  PLAYER_CROUCH_HEIGHT, PLAYER_HEIGHT, PLAYER_RADIUS, RUN_SPEED,
  SWIM_SPEED, WALK_SPEED,
} from '../core/constants';
import { Input } from '../core/Input';
import { PlayerState } from '../core/Save';
import { AABB, World } from '../world/World';

const MAX_STEP = 0.45;
/** seconds of relaxed step collision after a water mantle starts */
const MANTLE_TIME = 0.5;
/**
 * Metres per stride. Longer than a real one (~0.75 m) because the walk speed is
 * exaggerated too: at WALK_SPEED this lands about two steps a second, which is
 * what a person actually sounds like, instead of the sprint a literal stride
 * would give you.
 */
const STRIDE = 1.75;
const CROUCH_STRIDE = 1.05;
/** m/s of fall below which a landing is just the controller settling on a ledge */
const LAND_MIN_FALL = 2.2;
/** extra m/s on top of that for a landing to count as the full drop */
const LAND_FULL_FALL = 6;

export class Player {
  camera: THREE.PerspectiveCamera;
  position = new THREE.Vector3(16, 0, 16); // feet
  velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;

  height = PLAYER_HEIGHT;
  crouching = false;
  grounded = false;
  swimming = false;
  /** eye below the water surface */
  underwater = false;
  /** body in water (even if head is out) */
  inWater = false;
  running = false;
  moving = false;
  /** set by Game from survival stats — no sprinting while dehydrated */
  canRun = true;

  /** extra camera dip while drinking from a tap */
  drinkDip = 0;

  onFootstep: ((surface: 'carpet' | 'hard', intensity: number, inWater: boolean) => void) | null = null;
  onLand: ((surface: 'carpet' | 'hard', impact: number, inWater: boolean) => void) | null = null;
  onSplash: (() => void) | null = null;

  private bobTime = 0;
  private bobPhasePrev = 0;
  private solids: AABB[] = [];
  private wasInWater = false;
  private mantleTimer = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(72, aspect, 0.08, 120);
    this.camera.rotation.order = 'YXZ';
  }

  reset(x: number, z: number): void {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.yaw = Math.random() * Math.PI * 2;
    this.pitch = 0;
    this.height = PLAYER_HEIGHT;
    this.crouching = false;
    this.mantleTimer = 0;
  }

  saveState(): PlayerState {
    return {
      x: this.position.x, y: this.position.y, z: this.position.z,
      yaw: this.yaw, pitch: this.pitch,
    };
  }

  /** Come back standing and still: a checkpoint is never mid-fall. */
  loadState(s: PlayerState): void {
    this.position.set(s.x, s.y, s.z);
    this.velocity.set(0, 0, 0);
    this.yaw = s.yaw;
    this.pitch = s.pitch;
    this.height = PLAYER_HEIGHT;
    this.crouching = false;
    this.mantleTimer = 0;
  }

  get eyeY(): number {
    return this.position.y + this.height * EYE_RATIO;
  }

  /**
   * What is under the feet, as far as the ear is concerned. Only Level 0 is
   * carpeted; every other floor in the game is some flavour of hard, and they
   * all share one neutral step rather than each getting a character of its own.
   */
  private surfaceAt(world: World): 'carpet' | 'hard' {
    const a = world.biomeAt(this.position.x, this.position.z).ambienceId;
    return a === 'hum' || a === 'wrong' ? 'carpet' : 'hard';
  }

  update(dt: number, input: Input, world: World, sensitivity = 0.0023): void {
    // ---- look ----
    this.yaw -= input.mouseDX * sensitivity;
    this.pitch -= input.mouseDY * sensitivity;
    this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch));

    // ---- stance ----
    const wantCrouch = input.down('KeyC') || input.down('ControlLeft') || input.down('ControlRight');
    this.crouching = wantCrouch && !this.swimming;
    const targetHeight = this.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
    // don't stand up into a ceiling
    const ceil = world.ceilHeight(this.position.x, this.position.z);
    const allowedHeight = Math.min(targetHeight, ceil - this.position.y - 0.05);
    this.height += (Math.max(PLAYER_CROUCH_HEIGHT, allowedHeight) - this.height) * Math.min(1, dt * 10);

    // ---- water state ----
    const surface = world.waterSurfaceAt(this.position.x, this.position.z);
    const floorHere = world.groundHeight(this.position.x, this.position.z, PLAYER_RADIUS, this.position.y, MAX_STEP);
    this.inWater = surface !== null && this.position.y < surface - 0.25;
    const deepWater = surface !== null && surface - floorHere > 1.1;
    this.swimming = this.inWater && deepWater && this.position.y < surface - 0.55;
    this.underwater = surface !== null && this.eyeY < surface;
    if (this.inWater && !this.wasInWater) this.onSplash?.();
    this.wasInWater = this.inWater;

    // ---- desired horizontal velocity ----
    let fwd = 0, strafe = 0;
    if (input.down('KeyW')) fwd += 1;
    if (input.down('KeyS')) fwd -= 1;
    if (input.down('KeyD')) strafe += 1;
    if (input.down('KeyA')) strafe -= 1;
    // the on-screen stick is analog: a soft push walks slower than a full one
    const stick = Math.hypot(input.moveX, input.moveY);
    fwd += input.moveY;
    strafe += input.moveX;
    const len = Math.hypot(fwd, strafe);
    // only normalise past full tilt, so partial stick keeps its magnitude
    if (len > 1) { fwd /= len; strafe /= len; }
    this.moving = len > 0.05;

    // keys sprint on Shift; the stick sprints when you push it to the rim
    const wantRun = input.down('ShiftLeft') || stick > 0.95;
    this.running = wantRun && fwd > 0 && !this.crouching && !this.swimming && this.canRun;
    const speed = this.swimming ? SWIM_SPEED
      : this.crouching ? CROUCH_SPEED
        : this.running ? RUN_SPEED : WALK_SPEED;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = (strafe * cos - fwd * sin) * speed;
    const wishZ = (-strafe * sin - fwd * cos) * speed;

    const accel = this.grounded || this.swimming || this.mantleTimer > 0 ? 14 : 3.5;
    this.velocity.x += (wishX - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (wishZ - this.velocity.z) * Math.min(1, accel * dt);

    // ---- vertical ----
    this.mantleTimer = Math.max(0, this.mantleTimer - dt);
    if (this.swimming) {
      let vy = this.velocity.y * (1 - Math.min(1, dt * 4));
      vy -= 0.7 * dt; // slow sink
      if (input.down('Space')) vy += 6.5 * dt;
      if (wantCrouch) vy -= 5.0 * dt;
      this.velocity.y = THREE.MathUtils.clamp(vy, -2.5, 3.6);
      // near the surface, pushing toward a climbable edge: mantle out
      if (surface !== null && this.position.y > surface - 0.8 && this.moving && this.mantleTimer <= 0) {
        const ledge = this.findMantleLedge(world, surface, wishX, wishZ);
        if (ledge !== null) {
          this.mantleTimer = MANTLE_TIME;
          // enough upward speed to clear the ledge with a small margin
          this.velocity.y = Math.min(6.5, Math.sqrt(2 * GRAVITY * Math.max(0.3, ledge - this.position.y + 0.2)));
        }
      }
    } else {
      this.velocity.y -= GRAVITY * dt;
      if (this.grounded && input.pressed('Space')) {
        this.velocity.y = JUMP_VELOCITY * (this.crouching ? 0.7 : 1);
        this.grounded = false;
      }
    }

    // ---- integrate with collision (per-axis) ----
    const feetY = this.position.y;
    // while mantling, high floors (the pool rim) stop being solid walls so the
    // climb can carry over the lip; real walls remain separate AABBs
    world.collectSolids(this.position.x, this.position.z, feetY, this.mantleTimer > 0 ? 1.9 : MAX_STEP, this.solids);

    this.position.x += this.velocity.x * dt;
    let [rx] = World.resolveCircle(this.position.x, this.position.z, PLAYER_RADIUS, this.solids);
    this.position.x = rx;

    this.position.z += this.velocity.z * dt;
    const [rx2, rz2] = World.resolveCircle(this.position.x, this.position.z, PLAYER_RADIUS, this.solids);
    this.position.x = rx2;
    this.position.z = rz2;

    this.position.y += this.velocity.y * dt;

    const ground = world.groundHeight(this.position.x, this.position.z, PLAYER_RADIUS, feetY + 0.3, MAX_STEP);
    if (this.position.y <= ground) {
      this.position.y = ground;
      // Landing, before the fall is thrown away: below LAND_MIN_FALL this is the
      // controller settling over uneven floor every other frame, not a jump.
      if (!this.grounded && this.velocity.y < -LAND_MIN_FALL) {
        const impact = Math.min(1, (-this.velocity.y - LAND_MIN_FALL) / LAND_FULL_FALL);
        this.onLand?.(this.surfaceAt(world), impact, this.inWater);
      }
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    const ceilY = world.ceilHeight(this.position.x, this.position.z);
    if (this.position.y + this.height > ceilY) {
      this.position.y = ceilY - this.height;
      if (this.velocity.y > 0) this.velocity.y = 0;
    }

    // ---- head bob & camera ----
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    let bobAmp = 0;
    if (this.grounded && horizSpeed > 0.4) {
      // Bob runs off distance covered, not off a clock: one stride advances the
      // phase by exactly PI, so the head dips once per foot and the step lands
      // on the dip at any speed. Driving it from time meant the cadence drifted
      // out of step with how fast you were actually crossing the floor.
      const stride = this.crouching ? CROUCH_STRIDE : STRIDE;
      this.bobTime += (horizSpeed * dt / stride) * Math.PI;
      bobAmp = Math.min(0.05, 0.014 + horizSpeed * 0.005);
      const phase = Math.sin(this.bobTime);
      if (this.bobPhasePrev > 0 !== phase > 0) {
        const intensity = Math.min(1, Math.max(0, (horizSpeed - 1.2) / (RUN_SPEED - 1.2)));
        this.onFootstep?.(this.surfaceAt(world), intensity, this.inWater);
      }
      this.bobPhasePrev = phase;
    } else if (this.swimming) {
      this.bobTime += dt * 1.6;
      bobAmp = 0.03;
    }

    const bobY = Math.sin(this.bobTime * 2) * bobAmp;
    const bobX = Math.cos(this.bobTime) * bobAmp * 0.6;

    this.drinkDip = Math.max(0, this.drinkDip);
    this.camera.position.set(
      this.position.x + bobX * Math.cos(this.yaw),
      this.eyeY + bobY - this.drinkDip * 0.35,
      this.position.z - bobX * Math.sin(this.yaw),
    );
    this.camera.rotation.set(this.pitch - this.drinkDip * 0.5, this.yaw, Math.sin(this.bobTime) * bobAmp * 0.35);
  }

  /** Height of a climbable ledge around the move direction at the water's edge. */
  private findMantleLedge(world: World, surface: number, wishX: number, wishZ: number): number | null {
    let dirX = wishX;
    let dirZ = wishZ;
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-3) {
      dirX = -Math.sin(this.yaw);
      dirZ = -Math.cos(this.yaw);
    } else {
      dirX /= len;
      dirZ /= len;
    }
    const baseAngle = Math.atan2(dirX, dirZ);
    // fan of probes so edges work when approached at any angle, not just head-on
    for (const da of [0, 0.5, -0.5, 1.0, -1.0]) {
      const ax = Math.sin(baseAngle + da);
      const az = Math.cos(baseAngle + da);
      for (const dist of [PLAYER_RADIUS + 0.35, PLAYER_RADIUS + 0.85]) {
        const gi = Math.floor((this.position.x + ax * dist) / CELL);
        const gj = Math.floor((this.position.z + az * dist) / CELL);
        const f = world.floorAt(gi, gj);
        if (isFinite(f) && f > this.position.y + MAX_STEP && f <= surface + 0.9) return f;
      }
    }
    return null;
  }
}
