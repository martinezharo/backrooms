// The catalog is the shared vocabulary of the inventory, the combat code, the
// pickups and the save file. An item that cannot fit in the grid can be
// spawned but never picked up; one that cannot survive JSON comes back from a
// checkpoint as a hole in the player's bag.

import { describe, expect, it } from 'vitest';
import { INV_COLS, INV_ROWS, MAX_CARRY_WEIGHT } from '../../src/core/constants';
import { AMMO_PER_BOX, ITEMS, makeItem, reviveItem, snapshotItem } from '../../src/items/Items';

const ids = Object.keys(ITEMS);

describe('the catalog', () => {
  it('keys every item by its own id', () => {
    for (const [key, def] of Object.entries(ITEMS)) expect(def.id).toBe(key);
  });

  it('names every item', () => {
    for (const def of Object.values(ITEMS)) expect(def.name).toMatch(/\S/);
  });

  it.each(ids)('%s fits in the grid', (id) => {
    const def = ITEMS[id];
    expect(def.gridW).toBeGreaterThanOrEqual(1);
    expect(def.gridH).toBeGreaterThanOrEqual(1);
    expect(def.gridW).toBeLessThanOrEqual(INV_COLS);
    expect(def.gridH).toBeLessThanOrEqual(INV_ROWS);
  });

  it.each(ids)('%s can be carried on its own', (id) => {
    // An item heavier than the whole carry limit is scenery, not loot.
    expect(ITEMS[id].weight).toBeGreaterThan(0);
    expect(ITEMS[id].weight).toBeLessThanOrEqual(MAX_CARRY_WEIGHT);
  });

  it.each(ids)('%s has coherent combat stats for its kind', (id) => {
    const def = ITEMS[id];
    expect(['melee', 'ranged', 'throwable', 'tool', 'ammo']).toContain(def.kind);
    expect(def.damage).toBeGreaterThanOrEqual(0);
    expect(def.cooldown).toBeGreaterThanOrEqual(0);
    expect(def.range).toBeGreaterThanOrEqual(0);
    expect(def.durability).toBeGreaterThan(0);
    if (def.kind === 'melee' || def.kind === 'ranged' || def.kind === 'throwable') {
      expect(def.damage, `${id} does no damage`).toBeGreaterThan(0);
      expect(def.range, `${id} has no reach`).toBeGreaterThan(0);
    } else {
      expect(def.damage).toBe(0);
    }
  });

  it.each(ids)('%s describes itself to the player', (id) => {
    expect(ITEMS[id].description).toMatch(/\S/);
  });

  it('still holds the ids the rest of the game hard-codes', () => {
    // Renaming any of these silently breaks the objective, the torch, the
    // receiver or the escape — none of which fails loudly at runtime.
    for (const id of ['fuse', 'battery', 'flashlight', 'detector', 'bottle', 'pistol', 'ammo']) {
      expect(ITEMS[id], `the game asks for '${id}' by name`).toBeDefined();
    }
  });

  it('puts a sensible number of rounds in a box', () => {
    expect(AMMO_PER_BOX).toBeGreaterThan(0);
    expect(Number.isInteger(AMMO_PER_BOX)).toBe(true);
  });
});

describe('makeItem', () => {
  it('starts an item at full durability, unloaded and dry', () => {
    const knife = makeItem('knife');
    expect(knife.def).toBe(ITEMS.knife);
    expect(knife.durability).toBe(ITEMS.knife.durability);
    expect(knife.ammo).toBe(0);
    expect(knife.water).toBe(0);
  });

  it('can hand out a bottle with water already in it', () => {
    expect(makeItem('bottle', 30).water).toBe(30);
  });
});

describe('snapshotItem / reviveItem', () => {
  it('round-trips a worn, loaded, filled item', () => {
    const pistol = makeItem('pistol');
    pistol.ammo = 5;
    const back = reviveItem(snapshotItem(pistol))!;
    expect(back.def).toBe(ITEMS.pistol);
    expect(back.ammo).toBe(5);
  });

  it('writes an indestructible item as null, because JSON has no Infinity', () => {
    const snap = snapshotItem(makeItem('pistol'));
    expect(snap.durability).toBeNull();
    expect(JSON.parse(JSON.stringify(snap)).durability).toBeNull();
    expect(reviveItem(snap)!.durability).toBe(Infinity);
  });

  it('keeps a partly broken item exactly as worn as it was', () => {
    const wrench = makeItem('wrench');
    wrench.durability = 17;
    expect(reviveItem(snapshotItem(wrench))!.durability).toBe(17);
  });

  it('survives the round trip through actual JSON for every item', () => {
    for (const id of ids) {
      const item = makeItem(id, 3);
      const back = reviveItem(JSON.parse(JSON.stringify(snapshotItem(item))))!;
      expect(back, `${id} did not come back`).not.toBeNull();
      expect(back.def.id).toBe(id);
      expect(back.durability).toBe(item.durability);
      expect(back.water).toBe(item.water);
    }
  });

  it('drops an item this build no longer knows instead of crashing the load', () => {
    expect(reviveItem({ id: 'railgun', durability: 3, ammo: 0, water: 0 })).toBeNull();
  });

  it('fills in fields an older save never wrote', () => {
    const back = reviveItem({ id: 'bottle', durability: null } as never)!;
    expect(back.ammo).toBe(0);
    expect(back.water).toBe(0);
  });
});
