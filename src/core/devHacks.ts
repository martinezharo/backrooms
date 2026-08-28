// Keyboard shortcuts for development and headless checks. Keeping their
// implementation outside Game lets Vite remove this entire module when the
// build-time DEV_HACKS flag is false.

import { LAST_DEPTH, defForDepth } from '../world/Biomes';

export interface DevHackContext {
  depth: number;
  pressed: (code: string) => boolean;
  down: (code: string) => boolean;
  teleportToExit: () => boolean;
  teleportToDepth: (depth: number) => boolean;
  teleportToDescent: () => boolean;
  teleportToSub: () => boolean;
  message: (text: string) => void;
}

/**
 * PageDown / PageUp   one floor down / up; PageDown on the last jumps to the exit
 * Backslash           jump to this floor's way down
 * Shift+Backslash     jump to the thing that unlocks it, if it has one
 */
export function updateDevHacks(ctx: DevHackContext): void {
  let target = -1;
  if (ctx.pressed('PageDown')) target = ctx.depth + 1;
  if (ctx.pressed('PageUp')) target = ctx.depth - 1;
  if (target > LAST_DEPTH) {
    ctx.teleportToExit();
    ctx.message('DEV — THE EXIT');
    return;
  }
  if (target >= 0 && target <= LAST_DEPTH && target !== ctx.depth) {
    ctx.teleportToDepth(target);
    ctx.message(`DEV — ${defForDepth(target).name}`);
    return;
  }
  if (ctx.pressed('Backslash')) {
    const toSub = ctx.down('ShiftLeft') || ctx.down('ShiftRight');
    const ok = toSub ? ctx.teleportToSub() : ctx.teleportToDescent();
    ctx.message(ok
      ? `DEV — ${toSub ? 'THE UNLOCK' : 'THE WAY DOWN'}`
      : 'DEV — NOTHING TO JUMP TO');
  }
}
