// Spawns/despawns enemies around the player, always out of sight, biome-
// weighted, never too close. A steady trickle keeps the floor populated;
// the stalking AI is what keeps them discreet.

import * as THREE from 'three';
import { FriendState } from '../core/Save';
import { BiomeId } from '../world/Biomes';
import { World } from '../world/World';
import { Enemy, EnemyContext } from './Enemy';
import { Hound, Partygoer, SkinStealer, Smiler } from './types';

const MAX_ENEMIES = 5;
const SPAWN_MIN = 22;
const SPAWN_MAX = 42;
const DESPAWN = 70;
/** seconds before anything is allowed near a fresh run */
const FIRST_GRACE = 20;
/** seconds between spawn attempts while below the cap */
const SPAWN_EVERY_MIN = 14;
const SPAWN_EVERY_RAND = 18;

type EnemyCtor = new () => Enemy;

const WEIGHTS: Record<BiomeId, [EnemyCtor, number][]> = {
  [BiomeId.Level0]: [[Partygoer, 0.45], [Hound, 0.25], [SkinStealer, 0.2], [Smiler, 0.1]],
  [BiomeId.Level2]: [[Hound, 0.4], [Smiler, 0.35], [SkinStealer, 0.25]],
  [BiomeId.Level37]: [[SkinStealer, 0.5], [Smiler, 0.3], [Hound, 0.2]],
  [BiomeId.Level7]: [[Smiler, 0.7], [SkinStealer, 0.3]],
};

/** Only friends are ever restored, so the save keeps a name, not a class. */
const BY_VOICE: Record<string, EnemyCtor> = {
  smiler: Smiler, stealer: SkinStealer, hound: Hound, partygoer: Partygoer,
};

export class Spawner {
  enemies: Enemy[] = [];
  private scene: THREE.Scene;
  private world: World;
  private timer = FIRST_GRACE;
  /** 0..1 — rises with every fuse pulled; the level notices. */
  private pressure = 0;

  /** How aware the floor is of what you're doing. */
  setPressure(p: number): void {
    this.pressure = Math.max(0, Math.min(1, p));
  }

  private get maxEnemies(): number {
    return MAX_ENEMIES + Math.round(this.pressure * 3);
  }

  onSpawn: ((e: Enemy) => void) | null = null;
  onRemove: ((e: Enemy) => void) | null = null;

  constructor(scene: THREE.Scene, world: World) {
    this.scene = scene;
    this.world = world;
  }

  update(dt: number, ctx: EnemyContext): void {
    ctx.enemies = this.enemies;
    for (const e of this.enemies) e.update(dt, ctx);

    // cull dead/far enemies (friends are never abandoned)
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const far = !e.befriended && e.position.distanceTo(ctx.player.position) > DESPAWN;
      if (e.removeMe || far) {
        this.scene.remove(e.mesh);
        e.dispose();
        this.onRemove?.(e);
        this.enemies.splice(i, 1);
      }
    }

    // when one hound commits, the pack joins the hunt
    const leader = this.enemies.find((e) => e instanceof Hound && e.state === 'chase');
    if (leader) {
      for (const e of this.enemies) {
        if (e instanceof Hound && !e.befriended && (e.state === 'stalk' || e.state === 'wander')
          && e.position.distanceTo(leader.position) < 20) {
          e.state = 'chase';
        }
      }
    }

    // steady trickle of spawns while below the cap (befriended ones don't count)
    this.timer -= dt;
    if (this.timer <= 0) {
      const hurry = 1 - this.pressure * 0.55;
      if (this.hostileCount() < this.maxEnemies) {
        const before = this.enemies.length;
        this.trySpawn(ctx.player.position);
        // no valid hidden spot — retry shortly instead of waiting a full cycle
        this.timer = this.enemies.length > before
          ? (SPAWN_EVERY_MIN + Math.random() * SPAWN_EVERY_RAND) * hurry
          : 4;
      } else {
        this.timer = SPAWN_EVERY_MIN * hurry;
      }
    }
  }

  private hostileCount(): number {
    let n = 0;
    for (const e of this.enemies) if (!e.befriended) n++;
    return n;
  }

  private trySpawn(playerPos: THREE.Vector3): void {
    // never let one pop into view: require a wall between spawn spot and player
    let spot: THREE.Vector3 | null = null;
    for (let attempt = 0; attempt < 5 && !spot; attempt++) {
      const s = this.world.findSpawnSpot(playerPos.x, playerPos.z, SPAWN_MIN, SPAWN_MAX, Math.random);
      if (s && this.world.lineBlocked(s.x, s.z, playerPos.x, playerPos.z)) spot = s;
    }
    if (!spot) return;
    const biome = this.world.biomeAt(spot.x, spot.z).id;
    const table = WEIGHTS[biome];
    let r = Math.random();
    let Ctor: EnemyCtor = table[0][0];
    for (const [cls, w] of table) {
      r -= w;
      if (r <= 0) { Ctor = cls; break; }
    }
    const count = Ctor === Hound ? 2 + (Math.random() < 0.4 ? 1 : 0) : 1;
    for (let i = 0; i < count; i++) {
      if (this.hostileCount() >= this.maxEnemies) break;
      const e = new Ctor();
      const p = spot.clone();
      p.x += (Math.random() - 0.5) * 2;
      p.z += (Math.random() - 0.5) * 2;
      e.init(p);
      if (e instanceof Hound) e.flankAngle = (i - 1) * 0.7;
      this.scene.add(e.mesh);
      this.enemies.push(e);
      this.onSpawn?.(e);
    }
  }

  /** Distance to the nearest enemy that is actively hunting, for the tension system. */
  dangerLevel(playerPos: THREE.Vector3): number {
    let danger = 0;
    for (const e of this.enemies) {
      if (!e.alive || e.befriended) continue;
      const d = e.position.distanceTo(playerPos);
      const proximity = Math.max(0, 1 - d / 30);
      const weight = e.state === 'chase' || e.state === 'attack' ? 1
        : e.state === 'stalk' ? 0.18 : 0.3;
      danger = Math.max(danger, proximity * weight);
    }
    return danger;
  }

  /**
   * Hostiles are never saved — they are a trickle around the player and the
   * floor is happy to send more. The ones you hugged are yours to keep.
   */
  saveState(): FriendState[] {
    return this.enemies
      .filter((e) => e.befriended && e.alive)
      .map((e) => ({ voiceId: e.voiceId, x: e.position.x, y: e.position.y, z: e.position.z }));
  }

  loadState(friends: FriendState[]): void {
    for (const f of friends) {
      const Ctor = BY_VOICE[f.voiceId];
      if (!Ctor) continue;
      const e = new Ctor();
      e.init(new THREE.Vector3(f.x, f.y, f.z));
      e.befriend();
      this.scene.add(e.mesh);
      this.enemies.push(e);
      this.onSpawn?.(e);
    }
  }

  reset(): void {
    for (const e of this.enemies) {
      this.scene.remove(e.mesh);
      e.dispose();
      this.onRemove?.(e);
    }
    this.enemies.length = 0;
    this.timer = FIRST_GRACE;
  }
}
