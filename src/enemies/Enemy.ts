// Enemy base: A* pathfinding over the cell grid, steering, attack loop,
// hit reactions. Subclasses provide the body, animation and behaviour tweaks.

import * as THREE from 'three';
import { CELL } from '../core/constants';
import { AABB, World } from '../world/World';
import { Player } from '../player/Player';
import { Lighting } from '../rendering/Lighting';

export interface EnemyContext {
  world: World;
  player: Player;
  lighting: Lighting;
  time: number;
  isBlocking: () => boolean;
  damagePlayer: (amount: number, cause: string) => void;
  /** 0..1 — how loud/danger-driving this enemy currently is */
  notifySound?: (e: Enemy, intensity: number) => void;
}

export type EnemyState = 'wander' | 'stalk' | 'chase' | 'attack' | 'flee' | 'stunned';

// scratch vectors for hot per-frame senses (no allocation)
const _camFwd = new THREE.Vector3();
const _toMe = new THREE.Vector3();

interface PathNode { gi: number; gj: number; g: number; f: number; parent: PathNode | null; }

export abstract class Enemy {
  abstract readonly typeName: string;
  abstract readonly voiceId: 'smiler' | 'stealer' | 'hound' | 'partygoer';

  mesh = new THREE.Group();
  position = new THREE.Vector3();
  hp = 50;
  speed = 2;
  damage = 10;
  attackRange = 1.7;
  attackCooldown = 1.4;
  aggroRange = 16;
  radius = 0.38;
  bodyHeight = 1.7;

  // ---- stalking personality (tuned per type) ----
  /** detection radius for noticing the player and starting to stalk */
  stalkRange = 24;
  /** preferred shadowing distance band while stalking */
  stalkDistMin = 9;
  stalkDistMax = 15;
  /** boldness gain multiplier — how quickly it works up to an ambush */
  patience = 1;
  /** stop dead while the player is looking, then slip away */
  freezeWhenSeen = true;
  /** boldness needed before it will commit to a chase */
  commitThreshold = 1;
  /** only commit within this distance (corner ambushers keep it short) */
  commitMaxDist = Infinity;
  /** scoring bonus for stalk points hidden from the player */
  protected coverBonus = 4;

  state: EnemyState = 'wander';
  alive = true;
  /** set when hp hits 0; Spawner removes after the death animation */
  removeMe = false;

  protected stunTimer = 0;
  protected attackTimer = 0;
  protected pathTimer = 0;
  protected wanderTarget: THREE.Vector3 | null = null;
  protected path: THREE.Vector3[] = [];
  protected walkPhase = 0;
  protected hitFlash = 0;
  /** 0..1 — willingness to attack, built up while stalking unobserved */
  protected boldness = 0;
  /** true this frame when caught in the player's gaze and standing still */
  protected frozen = false;
  protected seenTimer = 0;
  protected whisperTimer = 12 + Math.random() * 18;
  protected stalkPoint: THREE.Vector3 | null = null;
  protected stalkRepathTimer = 0;
  /** subclasses jolt limbs/head with this (1 on fire, decays fast) */
  protected twitch = 0;
  /** optional head group that tracks the player (set by subclasses) */
  protected headPivot: THREE.Group | null = null;
  private twitchTimer = 2 + Math.random() * 6;
  private headYaw = 0;
  private headPitch = 0;
  private outOfRangeTimer = 0;
  private loseTimer = 0;
  private deathTimer = 0;
  private velocity = new THREE.Vector3();
  private solids: AABB[] = [];
  private flashables: { mat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial; col: THREE.Color }[] = [];

  /** subclass speed modifier per frame (e.g. Smiler in light) */
  protected speedMult = 1;

  init(pos: THREE.Vector3): void {
    this.position.copy(pos);
    this.buildBody();
    this.mesh.position.copy(pos);
    this.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material;
        if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshBasicMaterial) {
          this.flashables.push({ mat: m, col: m.color.clone() });
        }
      }
    });
  }

  protected abstract buildBody(): void;
  protected abstract animate(dt: number, moveSpeed: number, ctx: EnemyContext): void;

  takeDamage(amount: number, knockDir?: THREE.Vector3): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.hitFlash = 1;
    if (knockDir) {
      this.velocity.add(knockDir.clone().setY(0).normalize().multiplyScalar(2.5));
    }
    if (this.state === 'wander' || this.state === 'stalk') this.state = 'chase';
    if (this.hp <= 0) {
      this.alive = false;
      this.deathTimer = 0.8;
    }
  }

  stun(seconds: number): void {
    if (!this.alive) return;
    this.stunTimer = Math.max(this.stunTimer, seconds);
    this.state = 'stunned';
  }

  update(dt: number, ctx: EnemyContext): void {
    if (!this.alive) {
      this.deathTimer -= dt;
      const s = Math.max(0.01, this.deathTimer / 0.8);
      this.mesh.scale.set(s, s * 0.6, s);
      this.mesh.position.y = this.position.y;
      if (this.deathTimer <= 0) this.removeMe = true;
      return;
    }

    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    for (const f of this.flashables) {
      f.mat.color.copy(f.col).lerp(new THREE.Color(0xff2010), this.hitFlash * 0.85);
    }

    const toPlayer = ctx.player.position.clone().sub(this.position);
    const distToPlayer = toPlayer.length();

    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      if (this.stunTimer <= 0) {
        this.state = distToPlayer < this.aggroRange ? 'chase'
          : distToPlayer < this.stalkRange ? 'stalk' : 'wander';
      }
      this.applyMovement(dt, ctx, new THREE.Vector3());
      this.animate(dt, 0, ctx);
      return;
    }

    this.think(dt, ctx, distToPlayer);

    // movement target from current state
    let moveDir = new THREE.Vector3();
    if (this.state === 'chase' || this.state === 'flee') {
      const target = this.state === 'flee'
        ? this.position.clone().sub(toPlayer.clone().setY(0).normalize().multiplyScalar(6))
        : ctx.player.position;
      this.followPath(dt, ctx.world, target, moveDir);
    } else if (this.state === 'stalk') {
      if (!this.frozen && this.stalkPoint) {
        this.followPath(dt, ctx.world, this.stalkPoint, moveDir, 0.6);
      }
    } else if (this.state === 'wander') {
      if (!this.wanderTarget || this.position.distanceTo(this.wanderTarget) < 1 || Math.random() < dt * 0.15) {
        // roam with a pull toward the player's area so it eventually finds you
        const bx = this.position.x + (ctx.player.position.x - this.position.x) * 0.45;
        const bz = this.position.z + (ctx.player.position.z - this.position.z) * 0.45;
        this.wanderTarget = ctx.world.findSpawnSpot(bx, bz, 2, 10, Math.random) ?? null;
        this.path = [];
        this.pathTimer = 0;
      }
      if (this.wanderTarget) this.followPath(dt, ctx.world, this.wanderTarget, moveDir, 0.45);
    }

    // attack
    if (this.state === 'chase' && distToPlayer < this.attackRange && ctx.player.position.y - this.position.y < 1.4) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        this.attackTimer = this.attackCooldown;
        const dmg = ctx.isBlocking() ? this.damage * 0.45 : this.damage;
        ctx.damagePlayer(dmg, this.typeName);
        ctx.notifySound?.(this, 1);
      }
    } else {
      this.attackTimer = Math.min(this.attackTimer, 0.35);
    }

    const moved = this.applyMovement(dt, ctx, moveDir.multiplyScalar(this.speed * this.speedMult));
    this.walkPhase += moved * 2.2;
    this.animate(dt, moved / Math.max(dt, 1e-4), ctx);

    // face movement / player; frozen stalkers stare straight at you
    const faceTarget = this.state === 'chase' || (this.state === 'stalk' && this.frozen)
      ? ctx.player.position
      : this.position.clone().add(moveDir);
    const fdx = faceTarget.x - this.position.x;
    const fdz = faceTarget.z - this.position.z;
    if (Math.abs(fdx) + Math.abs(fdz) > 0.05) {
      const targetYaw = Math.atan2(fdx, fdz);
      let d = targetYaw - this.mesh.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.mesh.rotation.y += d * Math.min(1, dt * 7);
    }

    this.updateHead(dt, ctx, distToPlayer);

    // random twitch, more frequent while stalking
    this.twitch = Math.max(0, this.twitch - dt * 6);
    this.twitchTimer -= dt * (this.state === 'stalk' ? 3 : 1);
    if (this.twitchTimer <= 0) {
      this.twitch = 1;
      this.twitchTimer = 3 + Math.random() * 7;
    }
  }

  /** the head slowly turns to follow the player — slightly past natural */
  private updateHead(dt: number, ctx: EnemyContext, distToPlayer: number): void {
    if (!this.headPivot) return;
    let ty = 0;
    let tp = 0;
    if (distToPlayer < 24
      && !ctx.world.lineBlocked(this.position.x, this.position.z, ctx.player.position.x, ctx.player.position.z)) {
      const dx = ctx.player.position.x - this.position.x;
      const dz = ctx.player.position.z - this.position.z;
      let d = Math.atan2(dx, dz) - this.mesh.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      ty = THREE.MathUtils.clamp(d, -1.15, 1.15);
      const dy = ctx.player.eyeY - (this.position.y + this.bodyHeight * 0.9);
      tp = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.55, 0.55);
    }
    this.headYaw += (ty - this.headYaw) * Math.min(1, dt * 5);
    this.headPitch += (tp - this.headPitch) * Math.min(1, dt * 5);
    this.headPivot.rotation.y = this.headYaw;
    this.headPivot.rotation.x = -this.headPitch;
  }

  /** Is the player's camera actually pointed at me with a clear line of sight? */
  protected playerCanSeeMe(ctx: EnemyContext, distToPlayer: number): boolean {
    if (distToPlayer > 30) return false;
    if (ctx.world.lineBlocked(this.position.x, this.position.z, ctx.player.position.x, ctx.player.position.z)) {
      return false;
    }
    ctx.player.camera.getWorldDirection(_camFwd);
    _toMe.set(
      this.position.x - ctx.player.position.x,
      this.position.y + this.bodyHeight * 0.6 - ctx.player.eyeY,
      this.position.z - ctx.player.position.z,
    ).normalize();
    return _camFwd.dot(_toMe) > 0.42;
  }

  /** hook for types whose nerve depends on conditions (Smiler: light) */
  protected boldnessGainMult(_ctx: EnemyContext): number { return 1; }

  /** default behaviour: notice → stalk → ambush; subclasses tune/override */
  protected think(dt: number, ctx: EnemyContext, distToPlayer: number): void {
    this.frozen = false;
    if (this.state === 'wander') {
      // discovery is silent — the player finds out by spotting it (or too late)
      if (distToPlayer < this.stalkRange
        && !ctx.world.lineBlocked(this.position.x, this.position.z, ctx.player.position.x, ctx.player.position.z)) {
        this.state = 'stalk';
        this.seenTimer = 0;
        this.outOfRangeTimer = 0;
      }
    } else if (this.state === 'stalk') {
      this.updateStalk(dt, ctx, distToPlayer);
    } else if (this.state === 'chase') {
      const losBlocked = ctx.world.lineBlocked(
        this.position.x, this.position.z, ctx.player.position.x, ctx.player.position.z);
      this.loseTimer = losBlocked ? this.loseTimer + dt : 0;
      if (this.loseTimer > 6 && distToPlayer > 8) {
        // lost you — go back to lurking instead of bee-lining forever
        this.state = 'stalk';
        this.boldness = 0.35;
        this.loseTimer = 0;
      } else if (distToPlayer > Math.max(this.aggroRange * 2.4, this.stalkRange * 1.6)) {
        this.state = 'wander';
      }
    }
  }

  private updateStalk(dt: number, ctx: EnemyContext, distToPlayer: number): void {
    if (distToPlayer > this.stalkRange * 1.6) {
      this.outOfRangeTimer += dt;
      if (this.outOfRangeTimer > 4) {
        this.state = 'wander';
        this.boldness = 0;
        return;
      }
    } else {
      this.outOfRangeTimer = 0;
    }

    const seen = this.playerCanSeeMe(ctx, distToPlayer);
    const dark = !ctx.lighting.isLitArea(this.position, ctx.time);

    // nerve builds while unobserved, faster in the dark
    this.boldness = Math.min(1.2, this.boldness
      + dt * this.patience * (seen ? 0.01 : 0.05) * (dark ? 1.6 : 1) * this.boldnessGainMult(ctx));

    if (seen && this.freezeWhenSeen) {
      this.seenTimer += dt;
      if (this.seenTimer < 1.5) {
        this.frozen = true; // caught in the open: stop dead and stare back
      } else {
        // watched too long — slip away behind cover
        this.pickStalkPoint(ctx, true);
        this.boldness *= 0.6;
        this.seenTimer = 0;
      }
    } else {
      this.seenTimer = Math.max(0, this.seenTimer - dt * 2);
    }

    // shadow the player from the preferred band
    this.stalkRepathTimer -= dt;
    if (!this.frozen
      && (this.stalkRepathTimer <= 0 || !this.stalkPoint || this.stalkPoint.distanceTo(this.position) < 1)) {
      this.pickStalkPoint(ctx, false);
    }

    // rare directional whisper — the only hint it is out there
    this.whisperTimer -= dt;
    if (this.whisperTimer <= 0) {
      if (distToPlayer < 22) ctx.notifySound?.(this, 0.4);
      this.whisperTimer = 12 + Math.random() * 18;
    }

    // the ambush: bold enough, and you are not looking (or it's dark, or too late)
    if (this.boldness >= this.commitThreshold
      && distToPlayer <= this.commitMaxDist
      && (!seen || dark || distToPlayer < 6)
      && Math.random() < dt * 1.5) {
      this.state = 'chase';
      this.boldness = 0;
      ctx.notifySound?.(this, 1);
    }
  }

  /** Pick a spot to shadow the player from: in the preferred distance band,
   *  ideally hidden behind geometry and behind the player's back. */
  protected pickStalkPoint(ctx: EnemyContext, retreat: boolean): void {
    this.stalkRepathTimer = 1.5 + Math.random() * 1.5;
    const p = ctx.player.position;
    ctx.player.camera.getWorldDirection(_camFwd);
    const bandMin = retreat ? this.stalkDistMax : this.stalkDistMin;
    const bandMax = retreat ? this.stalkDistMax * 1.8 : this.stalkDistMax;
    let best: THREE.Vector3 | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 8; i++) {
      const cand = ctx.world.findSpawnSpot(this.position.x, this.position.z, 2, retreat ? 14 : 10, Math.random);
      if (!cand) continue;
      const d = Math.hypot(cand.x - p.x, cand.z - p.z);
      let score = -Math.abs(d - (bandMin + bandMax) / 2);
      if (ctx.world.lineBlocked(cand.x, cand.z, p.x, p.z)) score += this.coverBonus;
      _toMe.set(cand.x - p.x, 0, cand.z - p.z).normalize();
      if (_camFwd.dot(_toMe) < 0) score += 2.5; // behind the player's back
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    if (best) {
      this.stalkPoint = best;
      this.path = [];
      this.pathTimer = 0;
    }
  }

  private followPath(dt: number, world: World, target: THREE.Vector3, outDir: THREE.Vector3, speedScale = 1): void {
    this.pathTimer -= dt;
    if (this.pathTimer <= 0) {
      this.pathTimer = 0.55 + Math.random() * 0.25;
      this.path = this.computePath(world, target) ?? [];
    }
    // consume reached waypoints
    while (this.path.length && this.path[0].distanceTo(this.position) < 0.7) {
      this.path.shift();
    }
    const wp = this.path[0] ?? target;
    outDir.set(wp.x - this.position.x, 0, wp.z - this.position.z);
    if (outDir.lengthSq() > 1e-6) outDir.normalize().multiplyScalar(speedScale);
  }

  private computePath(world: World, target: THREE.Vector3): THREE.Vector3[] | null {
    const sgi = Math.floor(this.position.x / CELL);
    const sgj = Math.floor(this.position.z / CELL);
    const tgi = Math.floor(target.x / CELL);
    const tgj = Math.floor(target.z / CELL);
    if (sgi === tgi && sgj === tgj) return [target.clone()];

    const open: PathNode[] = [{ gi: sgi, gj: sgj, g: 0, f: 0, parent: null }];
    const visited = new Map<string, number>();
    visited.set(`${sgi},${sgj}`, 0);
    const h = (gi: number, gj: number) => Math.abs(gi - tgi) + Math.abs(gj - tgj);
    let expansions = 0;

    while (open.length && expansions < 350) {
      expansions++;
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur.gi === tgi && cur.gj === tgj) {
        const pts: THREE.Vector3[] = [];
        let n: PathNode | null = cur;
        while (n && n.parent) {
          pts.push(new THREE.Vector3((n.gi + 0.5) * CELL, 0, (n.gj + 0.5) * CELL));
          n = n.parent;
        }
        pts.reverse();
        pts.push(target.clone());
        return pts;
      }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (!world.passable(cur.gi, cur.gj, di, dj, this.canSwim() ? 2.2 : 0.5)) continue;
        const ni = cur.gi + di;
        const nj = cur.gj + dj;
        const key = `${ni},${nj}`;
        const g = cur.g + 1;
        const prev = visited.get(key);
        if (prev !== undefined && prev <= g) continue;
        visited.set(key, g);
        open.push({ gi: ni, gj: nj, g, f: g + h(ni, nj), parent: cur });
      }
    }
    return null;
  }

  protected canSwim(): boolean { return false; }

  /** Move with collision; returns horizontal distance moved. */
  private applyMovement(dt: number, ctx: EnemyContext, wish: THREE.Vector3): number {
    this.velocity.x += (wish.x - this.velocity.x) * Math.min(1, dt * 8);
    this.velocity.z += (wish.z - this.velocity.z) * Math.min(1, dt * 8);

    const ox = this.position.x;
    const oz = this.position.z;
    ctx.world.collectSolids(this.position.x, this.position.z, this.position.y, this.canSwim() ? 2.2 : 0.5, this.solids);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    const [rx, rz] = World.resolveCircle(this.position.x, this.position.z, this.radius, this.solids);
    this.position.x = rx;
    this.position.z = rz;

    // stick to ground (enemies don't jump)
    const ground = ctx.world.groundHeight(this.position.x, this.position.z, this.radius, this.position.y + 0.3, this.canSwim() ? 2.5 : 0.6);
    this.position.y += (ground - this.position.y) * Math.min(1, dt * 10);

    this.mesh.position.copy(this.position);
    return Math.hypot(this.position.x - ox, this.position.z - oz);
  }

  dispose(): void {
    this.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
