// A run you can walk back into. The maze itself is never written down — every
// wall regenerates from the seed — so a save only holds what the level cannot
// work out on its own: where you are, what you took out of it and what you
// already did to the door.
//
// Best-effort, like Records: private-mode browsers simply never get a save.

import type { ItemSnapshot } from '../items/Items';

const KEY = 'backrooms.save.v1';
// 2: the world became a stack of levels instead of a patchwork of biomes, so
// every v1 save describes a floor plan that no longer exists.
const VERSION = 2;

export interface PlayerState {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
}

export interface StatsState {
  health: number;
  thirst: number;
  /** breath in the lungs; absent in saves written before there were any */
  oxygen?: number;
  /** seconds already spent past empty — dehydration accelerates */
  dehydration: number;
}

/** How far through this floor's toll you had got when you put the game down. */
export interface DescentState {
  /** 0..1 — the wall pushed in, the wheel cranked, the valve turned */
  progress: number;
  /** the way down is open and waiting */
  open: boolean;
  /** metres Level 37's water has risen so far */
  flood: number;
  /** you have stood in front of the wall with the digits on it */
  codeKnown: boolean;
}

export interface InventoryState {
  items: { item: ItemSnapshot; col: number; row: number }[];
  /** index into items, or null for empty hands */
  equipped: number | null;
}

export interface PickupsState {
  /** world spawn ids already taken; they never come back */
  consumed: string[];
  /** items the player left on the floor */
  drops: { item: ItemSnapshot; x: number; y: number; z: number }[];
}

export interface FriendState {
  voiceId: string;
  x: number; y: number; z: number;
}

export interface SaveGame {
  v: number;
  seed: number;
  savedAt: number;
  /** which floor you were on: an index into DEPTHS, not a level number */
  depth: number;
  descent: DescentState;
  time: number;
  survivalTime: number;
  player: PlayerState;
  stats: StatsState;
  inventory: InventoryState;
  pickups: PickupsState;
  /** monsters that got a hug and stayed */
  friends: FriendState[];
  torchCharge: number;
  torchOn: boolean;
  receiverOnExit: boolean;
  /** almond water machines and the servings left in each */
  vending: [string, number][];
  portalOpen: boolean;
  escapeFuses: number;
}

export type SaveInput = Omit<SaveGame, 'v' | 'savedAt'>;

export function loadSave(): SaveGame | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SaveGame;
    // a save from an older build describes a world this one no longer builds
    if (!s || s.v !== VERSION || !Number.isFinite(s.seed) || !s.player || !s.descent) return null;
    return s;
  } catch {
    return null;
  }
}

/** False when the browser has no storage to give — the UI says so out loud. */
export function writeSave(s: SaveInput): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, v: VERSION, savedAt: Date.now() }));
    return true;
  } catch {
    return false; // no storage — this run just won't be waiting for you
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
