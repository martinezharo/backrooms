// Grid inventory: 5x4 slots, items occupy rectangular footprints, 10 weight max.

import { INV_COLS, INV_ROWS, MAX_CARRY_WEIGHT } from '../core/constants';
import { ItemInstance } from './Items';

export interface PlacedItem {
  item: ItemInstance;
  col: number;
  row: number;
}

export class Inventory {
  items: PlacedItem[] = [];
  equipped: ItemInstance | null = null;

  onChanged: (() => void) | null = null;

  totalWeight(): number {
    return this.items.reduce((s, p) => s + p.item.def.weight, 0);
  }

  private occupied(): boolean[][] {
    const grid: boolean[][] = Array.from({ length: INV_ROWS }, () => new Array(INV_COLS).fill(false));
    for (const p of this.items) {
      for (let r = p.row; r < p.row + p.item.def.gridH; r++) {
        for (let c = p.col; c < p.col + p.item.def.gridW; c++) {
          grid[r][c] = true;
        }
      }
    }
    return grid;
  }

  private findSlot(w: number, h: number): { col: number; row: number } | null {
    const grid = this.occupied();
    for (let r = 0; r <= INV_ROWS - h; r++) {
      for (let c = 0; c <= INV_COLS - w; c++) {
        let free = true;
        for (let rr = r; rr < r + h && free; rr++) {
          for (let cc = c; cc < c + w && free; cc++) {
            if (grid[rr][cc]) free = false;
          }
        }
        if (free) return { col: c, row: r };
      }
    }
    return null;
  }

  canAdd(item: ItemInstance): 'ok' | 'weight' | 'space' {
    if (this.totalWeight() + item.def.weight > MAX_CARRY_WEIGHT) return 'weight';
    if (!this.findSlot(item.def.gridW, item.def.gridH)) return 'space';
    return 'ok';
  }

  add(item: ItemInstance): boolean {
    if (this.canAdd(item) !== 'ok') return false;
    const slot = this.findSlot(item.def.gridW, item.def.gridH)!;
    this.items.push({ item, col: slot.col, row: slot.row });
    this.onChanged?.();
    return true;
  }

  remove(item: ItemInstance): void {
    const i = this.items.findIndex((p) => p.item === item);
    if (i >= 0) this.items.splice(i, 1);
    if (this.equipped === item) this.equipped = null;
    this.onChanged?.();
  }

  /** Equip a weapon/tool; only one held at a time. Re-clicking unequips. */
  equip(item: ItemInstance | null): void {
    this.equipped = this.equipped === item ? null : item;
    this.onChanged?.();
  }

  has(id: string): ItemInstance | null {
    return this.items.find((p) => p.item.def.id === id)?.item ?? null;
  }

  clear(): void {
    this.items.length = 0;
    this.equipped = null;
    this.onChanged?.();
  }
}
