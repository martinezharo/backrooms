// The bag is a 5x4 grid with a weight limit, and it is the one system the
// player touches constantly. Two items overlapping in the grid, or a bag that
// loses what you were holding across a checkpoint, are both silent — the
// symptom is an item that has quietly stopped existing.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INV_COLS, INV_ROWS, MAX_CARRY_WEIGHT } from '../../src/core/constants';
import { Inventory } from '../../src/items/Inventory';
import { ITEMS, makeItem } from '../../src/items/Items';

let bag: Inventory;
beforeEach(() => { bag = new Inventory(); });

/** Every cell an item covers, so overlaps can be caught directly. */
function covered(inv: Inventory): string[] {
  const cells: string[] = [];
  for (const p of inv.items) {
    for (let r = p.row; r < p.row + p.item.def.gridH; r++) {
      for (let c = p.col; c < p.col + p.item.def.gridW; c++) cells.push(`${c},${r}`);
    }
  }
  return cells;
}

describe('adding', () => {
  it('places an item and reports the add', () => {
    expect(bag.add(makeItem('knife'))).toBe(true);
    expect(bag.items).toHaveLength(1);
    expect(bag.totalWeight()).toBe(ITEMS.knife.weight);
  });

  it('never overlaps two items, however oddly shaped', () => {
    for (const id of ['wrench', 'knife', 'pipe', 'bottle', 'fuse']) bag.add(makeItem(id));
    const cells = covered(bag);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('keeps every item inside the grid', () => {
    for (const id of ['extinguisher', 'wrench', 'pipe', 'knife', 'bottle', 'fuse']) {
      bag.add(makeItem(id));
    }
    for (const p of bag.items) {
      expect(p.col).toBeGreaterThanOrEqual(0);
      expect(p.row).toBeGreaterThanOrEqual(0);
      expect(p.col + p.item.def.gridW).toBeLessThanOrEqual(INV_COLS);
      expect(p.row + p.item.def.gridH).toBeLessThanOrEqual(INV_ROWS);
    }
  });

  it('refuses what would take you over the carry limit, and says why', () => {
    bag.add(makeItem('extinguisher'));  // 4
    bag.add(makeItem('wrench'));        // 3
    bag.add(makeItem('pipe'));          // 2
    expect(bag.totalWeight()).toBe(9);
    expect(bag.canAdd(makeItem('knife'))).toBe('ok');       // 10, exactly at the limit
    expect(bag.canAdd(makeItem('extinguisher'))).toBe('weight');
    expect(bag.add(makeItem('extinguisher'))).toBe(false);
    expect(bag.totalWeight()).toBeLessThanOrEqual(MAX_CARRY_WEIGHT);
  });

  it('refuses when the grid is full rather than dropping an item on the floor', () => {
    // Twenty one-weight singles would fill the grid long before the weight
    // limit, so 'space' is a distinct answer from 'weight'.
    const light = { ...ITEMS.fuse, weight: 0.1 };
    for (let i = 0; i < INV_COLS * INV_ROWS; i++) {
      const item = { def: light, durability: 1, ammo: 0, water: 0 };
      expect(bag.add(item), `slot ${i} should have been free`).toBe(true);
    }
    expect(bag.canAdd({ def: light, durability: 1, ammo: 0, water: 0 })).toBe('space');
  });

  it('does not fire onChanged for an add it refused', () => {
    const seen = vi.fn();
    for (let i = 0; i < 10; i++) bag.add(makeItem('extinguisher'));
    bag.onChanged = seen;
    expect(bag.add(makeItem('extinguisher'))).toBe(false);
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('equipping', () => {
  it('holds one thing at a time', () => {
    const knife = makeItem('knife');
    const pipe = makeItem('pipe');
    bag.add(knife);
    bag.add(pipe);
    bag.equip(knife);
    expect(bag.equipped).toBe(knife);
    bag.equip(pipe);
    expect(bag.equipped).toBe(pipe);
  });

  it('empties your hands when you pick the same thing twice', () => {
    const knife = makeItem('knife');
    bag.add(knife);
    bag.equip(knife);
    bag.equip(knife);
    expect(bag.equipped).toBeNull();
  });

  it('empties your hands when what you were holding leaves the bag', () => {
    const knife = makeItem('knife');
    bag.add(knife);
    bag.equip(knife);
    bag.remove(knife);
    expect(bag.equipped).toBeNull();
    expect(bag.items).toHaveLength(0);
  });

  it('leaves your hands alone when something else leaves the bag', () => {
    const knife = makeItem('knife');
    const pipe = makeItem('pipe');
    bag.add(knife);
    bag.add(pipe);
    bag.equip(knife);
    bag.remove(pipe);
    expect(bag.equipped).toBe(knife);
  });

  it('frees the space an item was taking', () => {
    bag.add(makeItem('extinguisher'));
    const wrench = makeItem('wrench');
    bag.add(wrench);
    const weight = bag.totalWeight();
    bag.remove(wrench);
    expect(bag.totalWeight()).toBe(weight - ITEMS.wrench.weight);
    expect(bag.add(makeItem('wrench'))).toBe(true);
  });
});

describe('has / clear', () => {
  it('finds an item by id and returns null for one you have not got', () => {
    const fuse = makeItem('fuse');
    bag.add(fuse);
    expect(bag.has('fuse')).toBe(fuse);
    expect(bag.has('pistol')).toBeNull();
  });

  it('empties the bag and your hands', () => {
    const knife = makeItem('knife');
    bag.add(knife);
    bag.equip(knife);
    bag.clear();
    expect(bag.items).toHaveLength(0);
    expect(bag.equipped).toBeNull();
    expect(bag.totalWeight()).toBe(0);
  });
});

describe('save and load', () => {
  it('brings back every item, where it was, and what you were holding', () => {
    const wrench = makeItem('wrench');
    const bottle = makeItem('bottle', 20);
    wrench.durability = 12;
    bag.add(wrench);
    bag.add(bottle);
    bag.equip(bottle);

    const restored = new Inventory();
    restored.loadState(JSON.parse(JSON.stringify(bag.saveState())));

    expect(restored.items.map((p) => [p.item.def.id, p.col, p.row]))
      .toEqual(bag.items.map((p) => [p.item.def.id, p.col, p.row]));
    expect(restored.equipped?.def.id).toBe('bottle');
    expect(restored.has('bottle')!.water).toBe(20);
    expect(restored.has('wrench')!.durability).toBe(12);
    expect(restored.totalWeight()).toBe(bag.totalWeight());
  });

  it('comes back empty-handed when nothing was equipped', () => {
    bag.add(makeItem('knife'));
    const restored = new Inventory();
    restored.loadState(bag.saveState());
    expect(restored.equipped).toBeNull();
  });

  it('replaces the old bag rather than appending to it', () => {
    bag.add(makeItem('knife'));
    const state = bag.saveState();
    bag.loadState(state);
    bag.loadState(state);
    expect(bag.items).toHaveLength(1);
  });

  it('drops an item this build no longer knows and keeps the right thing held', () => {
    const state = {
      items: [
        { item: { id: 'railgun', durability: 1, ammo: 0, water: 0 }, col: 0, row: 0 },
        { item: { id: 'knife', durability: 80, ammo: 0, water: 0 }, col: 2, row: 0 },
      ],
      equipped: 1,
    };
    bag.loadState(state);
    expect(bag.items.map((p) => p.item.def.id)).toEqual(['knife']);
    expect(bag.equipped?.def.id).toBe('knife');
  });

  it('leaves your hands empty when the held item is the one that vanished', () => {
    bag.loadState({
      items: [{ item: { id: 'railgun', durability: 1, ammo: 0, water: 0 }, col: 0, row: 0 }],
      equipped: 0,
    });
    expect(bag.items).toHaveLength(0);
    expect(bag.equipped).toBeNull();
  });

  it('survives an empty save', () => {
    bag.add(makeItem('knife'));
    bag.loadState({ items: [], equipped: null });
    expect(bag.items).toHaveLength(0);
    expect(bag.equipped).toBeNull();
  });
});
