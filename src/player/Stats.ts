// Health & thirst — Minecraft-style survival adapted to horror pacing.

import {
  DEHYDRATION_BASE, DROWN_DAMAGE, HEALTH_REGEN, OXYGEN_DRAIN, OXYGEN_REFILL,
  POOL_DRINK_RATE, TAP_DRINK_RATE, THIRST_DRAIN, THIRST_DRAIN_RUN_MULT,
} from '../core/constants';
import { StatsState } from '../core/Save';

export type DeathCause = 'dehydration' | 'drowning' | string; // else: killed by <enemy name>

export class Stats {
  health = 100;
  thirst = 100;
  /** breath left, 0..100; only ever spent with your head under */
  oxygen = 100;
  alive = true;
  private dehydrationTime = 0;
  private wasUnder = false;

  onDeath: ((cause: DeathCause) => void) | null = null;
  onDamage: ((amount: number) => void) | null = null;
  /** the first gasp on the way back up, so the mix can hear it */
  onBreath: (() => void) | null = null;

  reset(): void {
    this.health = 100;
    this.thirst = 100;
    this.oxygen = 100;
    this.alive = true;
    this.dehydrationTime = 0;
  }

  saveState(): StatsState {
    return {
      health: this.health, thirst: this.thirst,
      oxygen: this.oxygen, dehydration: this.dehydrationTime,
    };
  }

  loadState(s: StatsState): void {
    this.health = s.health;
    this.thirst = s.thirst;
    // a save from before there were lungs comes back with a full one
    this.oxygen = s.oxygen ?? 100;
    this.dehydrationTime = s.dehydration;
    this.alive = this.health > 0;
  }

  /**
   * @param underwater the eyes are below the surface — this is what costs
   *   breath. Being chest-deep in a pool does not.
   */
  update(dt: number, running: boolean, drinkingTap: boolean, submerged: boolean, underwater = false): void {
    if (!this.alive) return;

    // ---- lungs ----
    if (underwater) {
      this.oxygen = Math.max(0, this.oxygen - OXYGEN_DRAIN * dt);
      if (this.oxygen <= 0) this.applyDamage(DROWN_DAMAGE * dt, 'drowning', false);
    } else {
      // one gasp on the way up, not one per frame all the way back to full
      if (this.wasUnder && this.oxygen < 92) this.onBreath?.();
      this.oxygen = Math.min(100, this.oxygen + OXYGEN_REFILL * dt);
    }
    this.wasUnder = underwater;

    this.thirst -= THIRST_DRAIN * (running ? THIRST_DRAIN_RUN_MULT : 1) * dt;

    if (drinkingTap) this.thirst += TAP_DRINK_RATE * dt;
    if (submerged) this.thirst += POOL_DRINK_RATE * dt;
    this.thirst = Math.max(0, Math.min(100, this.thirst));

    if (this.thirst <= 0) {
      this.dehydrationTime += dt;
      const drain = DEHYDRATION_BASE + this.dehydrationTime * 0.12; // accelerates
      this.applyDamage(drain * dt, 'dehydration', false);
    } else {
      this.dehydrationTime = 0;
      if (this.thirst > 60 && this.health < 100) {
        this.health = Math.min(100, this.health + HEALTH_REGEN * dt);
      }
    }
  }

  applyDamage(amount: number, cause: DeathCause, flash = true): void {
    if (!this.alive) return;
    this.health -= amount;
    if (flash) this.onDamage?.(amount);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.onDeath?.(cause);
    }
  }
}
