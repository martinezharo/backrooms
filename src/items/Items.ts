// Item catalog. Weights/sizes feed the grid inventory; combat stats feed Combat.

export type ItemKind = 'melee' | 'ranged' | 'throwable' | 'tool' | 'ammo';

export interface ItemDef {
  id: string;
  name: string;
  weight: number;     // carry units (max total 10)
  gridW: number;
  gridH: number;
  kind: ItemKind;
  damage: number;
  cooldown: number;   // seconds between attacks
  durability: number; // hits before breaking (Infinity for fists-like)
  range: number;
  description: string;
}

export const ITEMS: Record<string, ItemDef> = {
  wrench: {
    id: 'wrench', name: 'PIPE WRENCH',
    weight: 3, gridW: 2, gridH: 1, kind: 'melee',
    damage: 25, cooldown: 1.1, durability: 60, range: 2.2,
    description: 'Heavy. Slow. Convincing.',
  },
  extinguisher: {
    id: 'extinguisher', name: 'FIRE EXTINGUISHER',
    weight: 4, gridW: 2, gridH: 2, kind: 'ranged',
    damage: 2, cooldown: 0.05, durability: 220, range: 6,
    description: 'Hold to spray. Stuns whatever is in the cloud.',
  },
  bottle: {
    id: 'bottle', name: 'GLASS BOTTLE',
    weight: 1, gridW: 1, gridH: 1, kind: 'throwable',
    damage: 16, cooldown: 0.5, durability: 1, range: 18,
    description: 'Carries water. Right click drinks, E fills it. Still throws.',
  },
  knife: {
    id: 'knife', name: 'KITCHEN KNIFE',
    weight: 1, gridW: 1, gridH: 1, kind: 'melee',
    damage: 12, cooldown: 0.45, durability: 80, range: 1.9,
    description: 'Fast and quiet.',
  },
  pipe: {
    id: 'pipe', name: 'METAL PIPE',
    weight: 2, gridW: 2, gridH: 1, kind: 'melee',
    damage: 18, cooldown: 0.8, durability: 70, range: 2.3,
    description: 'Standard issue backrooms hardware.',
  },
  pistol: {
    id: 'pistol', name: 'PISTOL',
    weight: 2, gridW: 2, gridH: 1, kind: 'ranged',
    damage: 50, cooldown: 0.6, durability: Infinity, range: 40,
    description: 'Loud. They will hear it.',
  },
  flashlight: {
    id: 'flashlight', name: 'TORCH',
    weight: 1, gridW: 1, gridH: 1, kind: 'tool',
    damage: 0, cooldown: 0, durability: Infinity, range: 0,
    description: 'Press F. Smilers hate it.',
  },
  detector: {
    id: 'detector', name: 'FIELD RECEIVER',
    weight: 1, gridW: 2, gridH: 1, kind: 'tool',
    damage: 0, cooldown: 0, durability: Infinity, range: 0,
    description: 'Points at whatever the level is hiding. Carry it, it works from the bag.',
  },
  fuse: {
    id: 'fuse', name: 'FUSE',
    weight: 1, gridW: 1, gridH: 1, kind: 'tool',
    damage: 0, cooldown: 0, durability: Infinity, range: 0,
    description: 'Three of these wake the door up. Do not drop it.',
  },
  battery: {
    id: 'battery', name: 'BATTERY',
    weight: 1, gridW: 1, gridH: 1, kind: 'tool',
    damage: 0, cooldown: 0, durability: Infinity, range: 0,
    description: 'Torch juice. Grabbing one tops the torch up on the spot.',
  },
  ammo: {
    id: 'ammo', name: '9MM BOX',
    weight: 1, gridW: 1, gridH: 1, kind: 'ammo',
    damage: 0, cooldown: 0, durability: Infinity, range: 0,
    description: '8 rounds.',
  },
};

export const AMMO_PER_BOX = 8;

export interface ItemInstance {
  def: ItemDef;
  durability: number;
  /** rounds loaded (pistol only) */
  ammo: number;
  /** thirst points held in it (bottle only), 0..BOTTLE_CAPACITY */
  water: number;
}

export function makeItem(id: string, water = 0): ItemInstance {
  const def = ITEMS[id];
  return { def, durability: def.durability, ammo: 0, water };
}

/** The instance state worth writing to a save — the def is looked up again. */
export interface ItemSnapshot {
  id: string;
  /** null = indestructible; JSON has no Infinity */
  durability: number | null;
  ammo: number;
  water: number;
}

export function snapshotItem(item: ItemInstance): ItemSnapshot {
  return {
    id: item.def.id,
    durability: isFinite(item.durability) ? item.durability : null,
    ammo: item.ammo,
    water: item.water,
  };
}

/** Rebuild an item from a save. Ids this build no longer knows are dropped. */
export function reviveItem(s: ItemSnapshot): ItemInstance | null {
  const def = ITEMS[s.id];
  if (!def) return null;
  return {
    def,
    durability: s.durability === null ? def.durability : s.durability,
    ammo: s.ammo ?? 0,
    water: s.water ?? 0,
  };
}
