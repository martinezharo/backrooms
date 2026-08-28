// Thirst, breath and health are the clock the whole run is played against.
// They also decide when the death screen appears — a bar that drains at the
// wrong rate, or a death that fires twice, is the run ending wrong.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEHYDRATION_BASE, DROWN_DAMAGE, HEALTH_REGEN, OXYGEN_DRAIN, OXYGEN_REFILL,
  POOL_DRINK_RATE, TAP_DRINK_RATE, THIRST_DRAIN, THIRST_DRAIN_RUN_MULT,
} from '../../src/core/constants';
import { Stats } from '../../src/player/Stats';

let stats: Stats;
beforeEach(() => { stats = new Stats(); });

/** dt as the game feeds it: many small steps, not one big one. */
function tick(s: Stats, seconds: number, opts: Partial<{
  running: boolean; drinkingTap: boolean; submerged: boolean; underwater: boolean;
}> = {}): void {
  const step = 1 / 60;
  const steps = Math.round(seconds / step);
  for (let i = 0; i < steps; i++) {
    s.update(step, !!opts.running, !!opts.drinkingTap, !!opts.submerged, !!opts.underwater);
  }
}

describe('a fresh body', () => {
  it('starts whole', () => {
    expect(stats).toMatchObject({ health: 100, thirst: 100, oxygen: 100, alive: true });
  });

  it('goes back to whole on reset', () => {
    stats.health = 3;
    stats.thirst = 0;
    stats.oxygen = 0;
    stats.alive = false;
    stats.reset();
    expect(stats).toMatchObject({ health: 100, thirst: 100, oxygen: 100, alive: true });
  });
});

describe('thirst', () => {
  it('drains at the tuned rate', () => {
    tick(stats, 10);
    expect(stats.thirst).toBeCloseTo(100 - THIRST_DRAIN * 10, 1);
  });

  it('drains faster while sprinting', () => {
    tick(stats, 5, { running: true });
    expect(stats.thirst).toBeCloseTo(100 - THIRST_DRAIN * THIRST_DRAIN_RUN_MULT * 5, 1);
  });

  it('refills at a tap and never past full', () => {
    stats.thirst = 50;
    tick(stats, 2, { drinkingTap: true });
    expect(stats.thirst).toBeCloseTo(50 + (TAP_DRINK_RATE - THIRST_DRAIN) * 2, 1);
    tick(stats, 60, { drinkingTap: true });
    expect(stats.thirst).toBe(100);
  });

  it('refills faster standing in a pool', () => {
    expect(POOL_DRINK_RATE).toBeGreaterThan(TAP_DRINK_RATE);
    stats.thirst = 10;
    tick(stats, 1, { submerged: true });
    expect(stats.thirst).toBeCloseTo(10 + (POOL_DRINK_RATE - THIRST_DRAIN) * 1, 1);
  });

  it('never goes below empty', () => {
    tick(stats, 400, { running: true });
    expect(stats.thirst).toBe(0);
  });
});

describe('health', () => {
  it('regenerates once thirst is comfortable', () => {
    stats.health = 50;
    tick(stats, 4);
    expect(stats.health).toBeCloseTo(50 + HEALTH_REGEN * 4, 1);
  });

  it('does not regenerate while thirst is low', () => {
    stats.health = 50;
    stats.thirst = 40;
    tick(stats, 4);
    expect(stats.health).toBe(50);
  });

  it('never regenerates past full', () => {
    stats.health = 99;
    tick(stats, 30);
    expect(stats.health).toBe(100);
  });
});

describe('dehydration', () => {
  it('starts hurting only once the bar is empty, and accelerates', () => {
    stats.thirst = 0;
    stats.health = 100;
    tick(stats, 1);
    const firstSecond = 100 - stats.health;
    expect(firstSecond).toBeGreaterThan(0);
    expect(firstSecond).toBeCloseTo(DEHYDRATION_BASE, 0);

    const before = stats.health;
    tick(stats, 1);
    expect(before - stats.health).toBeGreaterThan(firstSecond);
  });

  it('forgets the acceleration the moment you drink', () => {
    stats.thirst = 0;
    tick(stats, 20);
    stats.thirst = 80;
    tick(stats, 0.1);
    stats.thirst = 0;
    stats.health = 100;
    tick(stats, 1);
    expect(100 - stats.health).toBeCloseTo(DEHYDRATION_BASE, 0);
  });

  it('kills you, once, naming dehydration', () => {
    const died = vi.fn();
    stats.onDeath = died;
    stats.thirst = 0;
    stats.health = 2;
    tick(stats, 60);
    expect(stats.alive).toBe(false);
    expect(stats.health).toBe(0);
    expect(died).toHaveBeenCalledTimes(1);
    expect(died).toHaveBeenCalledWith('dehydration');
  });
});

describe('lungs', () => {
  it('spends breath only with your head under', () => {
    tick(stats, 3, { submerged: true });
    expect(stats.oxygen).toBe(100);
    tick(stats, 3, { submerged: true, underwater: true });
    expect(stats.oxygen).toBeCloseTo(100 - OXYGEN_DRAIN * 3, 1);
  });

  it('gives you a breath worth planning a dive around', () => {
    const seconds = 100 / OXYGEN_DRAIN;
    expect(seconds).toBeGreaterThan(15);
    expect(seconds).toBeLessThan(40);
  });

  it('refills faster than it drains, and stops at full', () => {
    expect(OXYGEN_REFILL).toBeGreaterThan(OXYGEN_DRAIN);
    stats.oxygen = 20;
    tick(stats, 1);
    expect(stats.oxygen).toBeCloseTo(20 + OXYGEN_REFILL, 0);
    tick(stats, 10);
    expect(stats.oxygen).toBe(100);
  });

  it('drowns you once the breath is gone', () => {
    const died = vi.fn();
    stats.onDeath = died;
    stats.oxygen = 0;
    stats.health = 100;
    stats.thirst = 50;    // below the regen threshold, so the drain reads clean
    tick(stats, 1, { underwater: true });
    expect(100 - stats.health).toBeCloseTo(DROWN_DAMAGE, 0);
    tick(stats, 60, { underwater: true });
    expect(died).toHaveBeenCalledExactlyOnceWith('drowning');
  });

  it('gasps once on the way up, not once per frame', () => {
    const gasp = vi.fn();
    stats.onBreath = gasp;
    tick(stats, 5, { underwater: true });
    tick(stats, 5);
    expect(gasp).toHaveBeenCalledTimes(1);
  });

  it('does not gasp after a shallow dip that cost nothing', () => {
    const gasp = vi.fn();
    stats.onBreath = gasp;
    tick(stats, 0.5, { underwater: true });   // barely under 8 points spent
    tick(stats, 2);
    expect(gasp).not.toHaveBeenCalled();
  });
});

describe('applyDamage', () => {
  it('flashes the screen by default and not when told not to', () => {
    const hit = vi.fn();
    stats.onDamage = hit;
    stats.applyDamage(5, 'goblin');
    expect(hit).toHaveBeenCalledWith(5);
    hit.mockClear();
    stats.applyDamage(5, 'goblin', false);
    expect(hit).not.toHaveBeenCalled();
  });

  it('names whatever killed you', () => {
    const died = vi.fn();
    stats.onDeath = died;
    stats.applyDamage(999, 'killed by SMILER');
    expect(died).toHaveBeenCalledExactlyOnceWith('killed by SMILER');
    expect(stats.health).toBe(0);
  });

  it('is inert once you are dead — no second death screen', () => {
    const died = vi.fn();
    stats.onDeath = died;
    stats.applyDamage(999, 'dehydration');
    stats.applyDamage(999, 'drowning');
    tick(stats, 5, { underwater: true });
    expect(died).toHaveBeenCalledTimes(1);
    expect(stats.health).toBe(0);
  });

  it('leaves the bars alone once you are dead', () => {
    stats.applyDamage(999, 'dehydration');
    const before = { thirst: stats.thirst, oxygen: stats.oxygen };
    tick(stats, 10, { running: true, underwater: true });
    expect(stats.thirst).toBe(before.thirst);
    expect(stats.oxygen).toBe(before.oxygen);
  });
});

describe('save and load', () => {
  it('round-trips the body, dehydration timer included', () => {
    stats.thirst = 0;
    tick(stats, 12);          // build up an acceleration to carry over
    const state = JSON.parse(JSON.stringify(stats.saveState()));

    const restored = new Stats();
    restored.loadState(state);
    expect(restored.health).toBeCloseTo(stats.health, 5);
    expect(restored.thirst).toBeCloseTo(stats.thirst, 5);
    expect(restored.oxygen).toBeCloseTo(stats.oxygen, 5);

    // the acceleration resumes where it left off rather than starting over
    const a = new Stats(); a.loadState(state); a.thirst = 0; a.health = 100;
    const b = new Stats(); b.thirst = 0; b.health = 100;
    tick(a, 1); tick(b, 1);
    expect(100 - a.health).toBeGreaterThan(100 - b.health);
  });

  it('gives a save written before there were lungs a full one', () => {
    stats.loadState({ health: 50, thirst: 50, dehydration: 0 });
    expect(stats.oxygen).toBe(100);
  });

  it('comes back dead if you were dead', () => {
    stats.loadState({ health: 0, thirst: 0, oxygen: 0, dehydration: 30 });
    expect(stats.alive).toBe(false);
  });
});
