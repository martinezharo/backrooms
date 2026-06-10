// Player combat: fists, melee weapons, bottle throwing, extinguisher spray,
// pistol hitscan. Owns the first-person viewmodel.

import * as THREE from 'three';
import { BLOCK_MULT, PUNCH_COOLDOWN, PUNCH_DAMAGE, PUNCH_RANGE } from '../core/constants';
import { Input } from '../core/Input';
import { Enemy } from '../enemies/Enemy';
import { buildItemMesh } from '../items/ItemMeshes';
import { Inventory } from '../items/Inventory';
import { AMMO_PER_BOX, ItemInstance } from '../items/Items';
import { World } from '../world/World';
import { Player } from './Player';

export type CombatSound =
  | 'swing' | 'hit' | 'punch' | 'gunshot' | 'click' | 'throw'
  | 'glassBreak' | 'itemBreak' | 'spray' | 'sprayStop' | 'reload';

interface Projectile {
  mesh: THREE.Group;
  vel: THREE.Vector3;
  item: ItemInstance;
  life: number;
}

export class Combat {
  blocking = false;
  aiming = false;
  reloadTimer = 0;

  onSound: ((s: CombatSound) => void) | null = null;
  onMessage: ((msg: string) => void) | null = null;

  private scene: THREE.Scene;
  private inventory: Inventory;
  private viewmodel = new THREE.Group();
  private viewmodelItem: ItemInstance | null | undefined = undefined; // undefined = force rebuild
  private fist: THREE.Mesh;
  private cooldown = 0;
  private swingAnim = 0;
  private pendingHit = 0;
  private projectiles: Projectile[] = [];
  private sprayPoints: THREE.Points;
  private sprayPositions: Float32Array;
  private sprayAges: Float32Array;
  private spraying = false;
  private muzzle: THREE.PointLight;
  private muzzleTimer = 0;
  private baseFov: number;

  constructor(scene: THREE.Scene, player: Player, inventory: Inventory) {
    this.scene = scene;
    this.inventory = inventory;
    this.baseFov = player.camera.fov;

    player.camera.add(this.viewmodel);
    scene.add(player.camera);
    this.viewmodel.position.set(0.3, -0.3, -0.55);

    this.fist = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.05, 0.1, 3, 8),
      new THREE.MeshStandardMaterial({ color: 0xc8a888, roughness: 0.8 }),
    );
    this.fist.rotation.x = Math.PI / 2.5;

    // extinguisher spray particle cloud
    const COUNT = 220;
    this.sprayPositions = new Float32Array(COUNT * 3);
    this.sprayAges = new Float32Array(COUNT).fill(99);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.sprayPositions, 3));
    this.sprayPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xe8f0ee, size: 0.16, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    this.sprayPoints.frustumCulled = false;
    scene.add(this.sprayPoints);

    this.muzzle = new THREE.PointLight(0xffcf80, 0, 9, 1.8);
    scene.add(this.muzzle);
  }

  get equipped(): ItemInstance | null {
    return this.inventory.equipped;
  }

  update(dt: number, input: Input, player: Player, world: World, enemies: Enemy[]): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.reloadTimer = Math.max(0, this.reloadTimer - dt);
    this.muzzleTimer = Math.max(0, this.muzzleTimer - dt);
    this.muzzle.intensity = this.muzzleTimer > 0 ? 60 : 0;

    const eq = this.equipped;
    this.refreshViewmodel(eq);

    const isMelee = !eq || eq.def.kind === 'melee';
    this.blocking = input.mouseDown[2] && isMelee;
    this.aiming = input.mouseDown[2] && eq?.def.id === 'pistol';

    // pistol ADS narrows the FOV slightly
    const targetFov = this.aiming ? this.baseFov - 14 : this.baseFov;
    if (Math.abs(player.camera.fov - targetFov) > 0.1) {
      player.camera.fov += (targetFov - player.camera.fov) * Math.min(1, dt * 10);
      player.camera.updateProjectionMatrix();
    }

    // ---- attacks ----
    const wantSpray = input.mouseDown[0] && eq?.def.id === 'extinguisher';
    if (wantSpray && eq) {
      this.handleSpray(dt, player, enemies, eq);
    } else if (this.spraying) {
      this.spraying = false;
      this.onSound?.('sprayStop');
    }

    if (input.mousePressed[0] && !wantSpray && this.cooldown <= 0 && this.reloadTimer <= 0) {
      if (!eq) this.startMelee(player, enemies, world, null);
      else if (eq.def.kind === 'melee') this.startMelee(player, enemies, world, eq);
      else if (eq.def.kind === 'throwable') this.throwItem(player, eq);
      else if (eq.def.id === 'pistol') this.firePistol(player, enemies, world, eq);
    }

    // delayed melee impact (mid-swing)
    if (this.pendingHit > 0) {
      this.pendingHit -= dt;
      if (this.pendingHit <= 0) this.applyMeleeHit(player, enemies, world);
    }

    this.updateProjectiles(dt, world, enemies);
    this.updateSprayParticles(dt);
    this.animateViewmodel(dt, player);
  }

  isBlocking(): boolean {
    return this.blocking;
  }

  damageMultiplierIn(): number {
    return this.blocking ? BLOCK_MULT : 1;
  }

  // ------------------------------------------------------------------

  private meleeTarget: { def: number; range: number } = { def: PUNCH_DAMAGE, range: PUNCH_RANGE };

  private startMelee(player: Player, _enemies: Enemy[], _world: World, item: ItemInstance | null): void {
    const dmg = item ? item.def.damage : PUNCH_DAMAGE;
    const range = item ? item.def.range : PUNCH_RANGE;
    this.cooldown = item ? item.def.cooldown : PUNCH_COOLDOWN;
    this.swingAnim = 1;
    this.meleeTarget = { def: dmg, range };
    this.pendingHit = 0.13;
    this.onSound?.(item ? 'swing' : 'punch');
    void player;
  }

  private applyMeleeHit(player: Player, enemies: Enemy[], world: World): void {
    const dir = new THREE.Vector3();
    player.camera.getWorldDirection(dir);
    const from = player.camera.position;
    let hitSomething = false;

    for (const e of enemies) {
      if (!e.alive) continue;
      const center = e.position.clone().setY(e.position.y + e.bodyHeight * 0.6);
      const to = center.clone().sub(from);
      const dist = to.length();
      if (dist > this.meleeTarget.range + e.radius) continue;
      if (to.normalize().dot(dir) < 0.55) continue;
      if (world.lineBlocked(from.x, from.z, center.x, center.z)) continue;
      e.takeDamage(this.meleeTarget.def, dir);
      hitSomething = true;
      break; // melee hits one target
    }

    if (hitSomething) {
      this.onSound?.('hit');
      this.consumeDurability(1);
    }
  }

  private throwItem(player: Player, item: ItemInstance): void {
    this.inventory.remove(item);
    this.cooldown = item.def.cooldown;
    const dir = new THREE.Vector3();
    player.camera.getWorldDirection(dir);
    const mesh = buildItemMesh(item.def.id);
    mesh.position.copy(player.camera.position).add(dir.clone().multiplyScalar(0.5));
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      vel: dir.multiplyScalar(14).add(new THREE.Vector3(0, 2.2, 0)),
      item,
      life: 4,
    });
    this.onSound?.('throw');
  }

  private firePistol(player: Player, enemies: Enemy[], world: World, item: ItemInstance): void {
    if (item.ammo <= 0) {
      // auto-reload from an ammo box if we carry one
      const box = this.inventory.has('ammo');
      if (box) {
        this.inventory.remove(box);
        item.ammo += AMMO_PER_BOX;
        this.reloadTimer = 1.2;
        this.onSound?.('reload');
        this.onMessage?.('RELOADED');
      } else {
        this.onSound?.('click');
        this.onMessage?.('NO AMMO');
      }
      return;
    }

    item.ammo--;
    this.cooldown = item.def.cooldown;
    this.swingAnim = 0.6; // recoil
    this.muzzleTimer = 0.06;
    this.muzzle.position.copy(player.camera.position);
    this.onSound?.('gunshot');
    this.inventory.onChanged?.();

    const dir = new THREE.Vector3();
    player.camera.getWorldDirection(dir);
    const from = player.camera.position;
    const spread = this.aiming ? 0.99955 : 0.998;
    let best: Enemy | null = null;
    let bestDist = item.def.range;
    for (const e of enemies) {
      if (!e.alive) continue;
      const center = e.position.clone().setY(e.position.y + e.bodyHeight * 0.6);
      const to = center.clone().sub(from);
      const dist = to.length();
      if (dist > bestDist) continue;
      if (to.normalize().dot(dir) < spread - (e.radius / Math.max(dist, 1)) * 0.18) continue;
      if (world.lineBlocked(from.x, from.z, center.x, center.z)) continue;
      best = e;
      bestDist = dist;
    }
    best?.takeDamage(item.def.damage, dir);
  }

  private handleSpray(dt: number, player: Player, enemies: Enemy[], item: ItemInstance): void {
    if (!this.spraying) {
      this.spraying = true;
      this.onSound?.('spray');
    }
    const dir = new THREE.Vector3();
    player.camera.getWorldDirection(dir);
    const from = player.camera.position;

    // emit particles
    for (let n = 0; n < 6; n++) {
      const i = this.sprayAges.findIndex((a) => a > 1.2);
      if (i < 0) break;
      this.sprayAges[i] = 0;
      const jitter = new THREE.Vector3(
        (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25,
      );
      const v = dir.clone().add(jitter).normalize().multiplyScalar(6 + Math.random() * 2);
      this.sprayPositions[i * 3] = from.x + dir.x * 0.5;
      this.sprayPositions[i * 3 + 1] = from.y - 0.15 + dir.y * 0.5;
      this.sprayPositions[i * 3 + 2] = from.z + dir.z * 0.5;
      this.sprayVels[i] = v;
    }

    // stun cone
    for (const e of enemies) {
      if (!e.alive) continue;
      const center = e.position.clone().setY(e.position.y + e.bodyHeight * 0.5);
      const to = center.clone().sub(from);
      const dist = to.length();
      if (dist > item.def.range) continue;
      if (to.normalize().dot(dir) < 0.78) continue;
      e.stun(0.9);
      e.takeDamage(item.def.damage * dt * 12, dir);
    }

    item.durability -= dt * 14;
    if (item.durability <= 0) {
      this.inventory.remove(item);
      this.spraying = false;
      this.onSound?.('itemBreak');
      this.onMessage?.('EXTINGUISHER EMPTY');
    }
  }

  private sprayVels: THREE.Vector3[] = [];

  private updateSprayParticles(dt: number): void {
    const pos = this.sprayPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.sprayAges.length; i++) {
      if (this.sprayAges[i] > 1.2) {
        this.sprayPositions[i * 3 + 1] = -999; // park offscreen
        continue;
      }
      this.sprayAges[i] += dt;
      const v = this.sprayVels[i];
      if (!v) continue;
      v.multiplyScalar(1 - dt * 2.2);
      v.y += dt * 0.4; // gas rises a little
      this.sprayPositions[i * 3] += v.x * dt;
      this.sprayPositions[i * 3 + 1] += v.y * dt;
      this.sprayPositions[i * 3 + 2] += v.z * dt;
    }
    pos.needsUpdate = true;
  }

  private updateProjectiles(dt: number, world: World, enemies: Enemy[]): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.vel.y -= 11 * dt;
      const next = p.mesh.position.clone().addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 9;

      let smashed = p.life <= 0;
      // enemy hit
      for (const e of enemies) {
        if (!e.alive) continue;
        const center = e.position.clone().setY(e.position.y + e.bodyHeight * 0.6);
        if (next.distanceTo(center) < e.radius + 0.45) {
          e.takeDamage(p.item.def.damage, p.vel);
          e.stun(1.6);
          smashed = true;
          break;
        }
      }
      // world hit
      if (!smashed) {
        const ground = world.groundHeight(next.x, next.z, 0.1, next.y + 1, 3);
        if (next.y <= ground + 0.05 ||
          world.lineBlocked(p.mesh.position.x, p.mesh.position.z, next.x, next.z)) {
          smashed = true;
        }
      }

      if (smashed) {
        this.onSound?.('glassBreak');
        this.scene.remove(p.mesh);
        p.mesh.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
        this.projectiles.splice(i, 1);
      } else {
        p.mesh.position.copy(next);
      }
    }
  }

  private consumeDurability(amount: number): void {
    const eq = this.equipped;
    if (!eq || !isFinite(eq.durability)) return;
    eq.durability -= amount;
    if (eq.durability <= 0) {
      this.inventory.remove(eq);
      this.onSound?.('itemBreak');
      this.onMessage?.(`${eq.def.name} BROKE`);
    } else {
      this.inventory.onChanged?.();
    }
  }

  private refreshViewmodel(eq: ItemInstance | null): void {
    if (this.viewmodelItem === eq) return;
    this.viewmodelItem = eq;
    this.viewmodel.clear();
    if (!eq) {
      this.viewmodel.add(this.fist);
      return;
    }
    const m = buildItemMesh(eq.def.id);
    m.rotation.y = Math.PI * 0.45;
    if (eq.def.id === 'pistol') {
      m.rotation.y = Math.PI * 0.5;
      m.scale.setScalar(1.2);
    }
    this.viewmodel.add(m);
  }

  private animateViewmodel(dt: number, player: Player): void {
    this.swingAnim = Math.max(0, this.swingAnim - dt * 3.2);
    const swing = Math.sin(this.swingAnim * Math.PI) * 0.7;
    const bob = player.moving && player.grounded ? Math.sin(performance.now() * 0.008) * 0.012 : 0;

    const tx = this.blocking ? 0.05 : this.aiming ? 0.0 : 0.3;
    const ty = (this.blocking ? -0.14 : -0.3) + bob - swing * 0.12;
    const tz = (this.aiming ? -0.4 : -0.55) + swing * -0.18;
    this.viewmodel.position.x += (tx - this.viewmodel.position.x) * Math.min(1, dt * 12);
    this.viewmodel.position.y += (ty - this.viewmodel.position.y) * Math.min(1, dt * 12);
    this.viewmodel.position.z += (tz - this.viewmodel.position.z) * Math.min(1, dt * 12);
    this.viewmodel.rotation.x = -swing * 1.1 + (this.blocking ? 0.5 : 0);
    this.viewmodel.rotation.z = this.blocking ? 0.9 : 0;
  }

  reset(): void {
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
    }
    this.projectiles.length = 0;
    this.spraying = false;
    this.cooldown = 0;
    this.swingAnim = 0;
  }
}
