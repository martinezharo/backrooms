// Health & thirst — Minecraft-style survival adapted to horror pacing.

import {
  DEHYDRATION_BASE, HEALTH_REGEN, POOL_DRINK_RATE, TAP_DRINK_RATE,
  THIRST_DRAIN, THIRST_DRAIN_RUN_MULT,
} from '../core/constants';

export type DeathCause = 'dehydration' | string; // string = killed by <enemy name>

export class Stats {
  health = 100;
  thirst = 100;
  alive = true;
  private dehydrationTime = 0;

  onDeath: ((cause: DeathCause) => void) | null = null;
  onDamage: ((amount: number) => void) | null = null;

  reset(): void {
    this.health = 100;
    this.thirst = 100;
    this.alive = true;
    this.dehydrationTime = 0;
  }

  update(dt: number, running: boolean, drinkingTap: boolean, submerged: boolean): void {
    if (!this.alive) return;

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
