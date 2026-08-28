// Combat owns targeting, ammo, durability and several Three.js view effects.
// None of those need a renderer: real scene objects plus small World/Enemy
// doubles exercise the public update loop without a native canvas dependency.

import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOCK_MULT } from '../../src/core/constants';
import { Input } from '../../src/core/Input';
import { Enemy } from '../../src/enemies/Enemy';
import { Inventory } from '../../src/items/Inventory';
import { ItemInstance, ITEMS, makeItem } from '../../src/items/Items';
import { Combat, CombatSound } from '../../src/player/Combat';
import { Player } from '../../src/player/Player';
import { World } from '../../src/world/World';

interface Rig {
  scene: THREE.Scene;
  player: Player;
  inventory: Inventory;
  combat: Combat;
  input: Input;
  world: World;
}

function makeRig(item: ItemInstance | null = null): Rig {
  const scene = new THREE.Scene();
  const player = new Player(1);
  player.camera.position.set(0, 1.02, 0);
  player.camera.updateMatrixWorld(true);

  const inventory = new Inventory();
  if (item) {
    inventory.add(item);
    inventory.equip(item);
  }

  const input = {
    mouseDown: [false, false, false],
    mousePressed: [false, false, false],
  } as Input;
  const world = {
    lineBlocked: vi.fn(() => false),
    groundHeight: vi.fn(() => -100),
  } as unknown as World;

  return { scene, player, inventory, combat: new Combat(scene, player, inventory), input, world };
}

function enemyAt(z: number, x = 0) {
  const takeDamage = vi.fn();
  const stun = vi.fn();
  const enemy = {
    alive: true,
    position: new THREE.Vector3(x, 0, z),
    bodyHeight: 1.7,
    radius: 0.38,
    takeDamage,
    stun,
  } as unknown as Enemy;
  return { enemy, takeDamage, stun };
}

function update(rig: Rig, enemies: Enemy[], dt = 0.01): void {
  rig.combat.update(dt, rig.input, rig.player, rig.world, enemies);
}

function pressAttack(rig: Rig, enemies: Enemy[], dt = 0.01): void {
  rig.input.mousePressed[0] = true;
  update(rig, enemies, dt);
  rig.input.mousePressed[0] = false;
}

describe('melee', () => {
  it('hits one visible target after the swing delay and consumes durability', () => {
    const knife = makeItem('knife');
    knife.durability = 2;
    const rig = makeRig(knife);
    const first = enemyAt(-1.2);
    const second = enemyAt(-1.4);
    const sounds: CombatSound[] = [];
    rig.combat.onSound = (sound) => sounds.push(sound);

    pressAttack(rig, [first.enemy, second.enemy]);
    expect(first.takeDamage).not.toHaveBeenCalled();

    update(rig, [first.enemy, second.enemy], 0.2);
    expect(first.takeDamage).toHaveBeenCalledWith(ITEMS.knife.damage, expect.any(THREE.Vector3));
    expect(second.takeDamage).not.toHaveBeenCalled();
    expect(knife.durability).toBe(1);
    expect(sounds).toEqual(['swing', 'hit']);
  });

  it('does not hit through a wall or spend durability on a miss', () => {
    const wrench = makeItem('wrench');
    const rig = makeRig(wrench);
    const target = enemyAt(-1.2);
    vi.mocked(rig.world.lineBlocked).mockReturnValue(true);

    pressAttack(rig, [target.enemy]);
    update(rig, [target.enemy], 0.2);

    expect(target.takeDamage).not.toHaveBeenCalled();
    expect(wrench.durability).toBe(ITEMS.wrench.durability);
  });

  it('removes and reports a weapon when its last durability point is spent', () => {
    const knife = makeItem('knife');
    knife.durability = 1;
    const rig = makeRig(knife);
    const target = enemyAt(-1.2);
    const messages: string[] = [];
    rig.combat.onMessage = (message) => messages.push(message);

    pressAttack(rig, [target.enemy]);
    update(rig, [target.enemy], 0.2);

    expect(rig.inventory.has('knife')).toBeNull();
    expect(rig.combat.equipped).toBeNull();
    expect(messages).toEqual(['KITCHEN KNIFE BROKE']);
  });
});

describe('blocking and aiming', () => {
  it('uses the shared incoming-damage multiplier only for melee blocking', () => {
    const rig = makeRig();
    rig.input.mouseDown[2] = true;
    update(rig, []);
    expect(rig.combat.blocking).toBe(true);
    expect(rig.combat.damageMultiplierIn()).toBe(BLOCK_MULT);

    const pistol = makeItem('pistol');
    rig.inventory.add(pistol);
    rig.inventory.equip(pistol);
    update(rig, [], 0.1);
    expect(rig.combat.blocking).toBe(false);
    expect(rig.combat.aiming).toBe(true);
    expect(rig.combat.damageMultiplierIn()).toBe(1);
    expect(rig.player.camera.fov).toBe(58);
  });
});

describe('pistol', () => {
  it('spends one round and hits the nearest target along the sight line', () => {
    const pistol = makeItem('pistol');
    pistol.ammo = 2;
    const rig = makeRig(pistol);
    const near = enemyAt(-4);
    const far = enemyAt(-7);

    pressAttack(rig, [far.enemy, near.enemy]);

    expect(pistol.ammo).toBe(1);
    expect(near.takeDamage).toHaveBeenCalledWith(ITEMS.pistol.damage, expect.any(THREE.Vector3));
    expect(far.takeDamage).not.toHaveBeenCalled();
  });

  it('consumes an ammo box and starts a reload when the pistol is empty', () => {
    const pistol = makeItem('pistol');
    const rig = makeRig(pistol);
    const ammo = makeItem('ammo');
    rig.inventory.add(ammo);
    const sounds: CombatSound[] = [];
    const messages: string[] = [];
    rig.combat.onSound = (sound) => sounds.push(sound);
    rig.combat.onMessage = (message) => messages.push(message);

    pressAttack(rig, []);

    expect(rig.inventory.has('ammo')).toBeNull();
    expect(pistol.ammo).toBe(8);
    expect(rig.combat.reloadTimer).toBe(1.2);
    expect(sounds).toEqual(['reload']);
    expect(messages).toEqual(['RELOADED']);
  });

  it('clicks without changing the inventory when no ammunition exists', () => {
    const rig = makeRig(makeItem('pistol'));
    const sounds: CombatSound[] = [];
    const messages: string[] = [];
    rig.combat.onSound = (sound) => sounds.push(sound);
    rig.combat.onMessage = (message) => messages.push(message);

    pressAttack(rig, []);

    expect(rig.combat.equipped?.ammo).toBe(0);
    expect(sounds).toEqual(['click']);
    expect(messages).toEqual(['NO AMMO']);
  });
});

describe('throwables and spray', () => {
  it('throws a bottle, damages and stuns on impact, then removes its mesh', () => {
    const bottle = makeItem('bottle', 12);
    const rig = makeRig(bottle);
    const target = enemyAt(-1.2);
    const sounds: CombatSound[] = [];
    rig.combat.onSound = (sound) => sounds.push(sound);
    const before = rig.scene.children.length;

    pressAttack(rig, [target.enemy], 0.05);

    expect(rig.inventory.has('bottle')).toBeNull();
    expect(target.takeDamage).toHaveBeenCalledWith(ITEMS.bottle.damage, expect.any(THREE.Vector3));
    expect(target.stun).toHaveBeenCalledWith(1.6);
    expect(rig.scene.children).toHaveLength(before);
    expect(sounds).toEqual(['throw', 'glassBreak', 'splash']);
  });

  it('applies continuous extinguisher damage and removes an empty canister', () => {
    const extinguisher = makeItem('extinguisher');
    extinguisher.durability = 0.5;
    const rig = makeRig(extinguisher);
    const target = enemyAt(-2);
    const messages: string[] = [];
    rig.combat.onMessage = (message) => messages.push(message);
    rig.input.mouseDown[0] = true;

    update(rig, [target.enemy], 0.1);

    expect(target.stun).toHaveBeenCalledWith(0.9);
    expect(target.takeDamage).toHaveBeenCalledTimes(1);
    expect(target.takeDamage.mock.calls[0][0]).toBeCloseTo(2.4);
    expect(target.takeDamage.mock.calls[0][1]).toBeInstanceOf(THREE.Vector3);
    expect(rig.inventory.has('extinguisher')).toBeNull();
    expect(messages).toEqual(['EXTINGUISHER EMPTY']);
  });
});
