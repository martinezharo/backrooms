// Looking around. The mouse path is one multiplication, but the multiplier is
// a saved setting now, and the arrow keys are a second way in — added because
// a touchpad has an order of magnitude less travel than a mousepad and nowhere
// to pick itself up and start again.

import { describe, expect, it, vi } from 'vitest';
import { Input } from '../../src/core/Input';
import { Player } from '../../src/player/Player';
import { World } from '../../src/world/World';

/** Enough World for the controller to fall through one frame without touching anything. */
function flatWorld(): World {
  return {
    biomeAt: vi.fn(() => ({ ambienceId: 'hum' })),
    ceilHeight: vi.fn(() => 100),
    waterSurfaceAt: vi.fn(() => null),
    groundHeight: vi.fn(() => 0),
    collectSolids: vi.fn(),
    floorAt: vi.fn(() => 0),
  } as unknown as World;
}

/** Input is a plain state bag to the controller; a double keeps the DOM out. */
function held(...codes: string[]): Input {
  return {
    mouseDX: 0,
    mouseDY: 0,
    moveX: 0,
    moveY: 0,
    down: (code: string) => codes.includes(code),
    pressed: () => false,
  } as unknown as Input;
}

function looking(input: Input, lookSpeed?: number, dt = 0.5): Player {
  const player = new Player(1);
  player.update(dt, input, flatWorld(), lookSpeed);
  return player;
}

describe('mouse look', () => {
  it('turns by the built-in sensitivity when nothing is configured', () => {
    const input = held();
    input.mouseDX = 1000;
    expect(looking(input).yaw).toBeCloseTo(-2.3, 5);
  });

  it('scales with the saved look speed', () => {
    const input = held();
    input.mouseDX = 1000;
    expect(looking(input, 2).yaw).toBeCloseTo(-4.6, 5);
  });

  it('tilts on the vertical axis too', () => {
    const input = held();
    input.mouseDY = 100;
    expect(looking(input, 1).pitch).toBeCloseTo(-0.23, 5);
  });
});

describe('arrow-key look', () => {
  it.each([
    ['ArrowLeft', 1],
    ['ArrowRight', -1],
  ])('%s turns that way, by time rather than by pixels', (code, sign) => {
    expect(Math.sign(looking(held(code)).yaw)).toBe(sign);
  });

  it.each([
    ['ArrowUp', 1],
    ['ArrowDown', -1],
  ])('%s tilts that way', (code, sign) => {
    expect(Math.sign(looking(held(code)).pitch)).toBe(sign);
  });

  it('turns twice as far in twice the time', () => {
    const slow = looking(held('ArrowLeft'), 1, 0.25).yaw;
    const fast = looking(held('ArrowLeft'), 1, 0.5).yaw;
    expect(fast).toBeCloseTo(slow * 2, 5);
  });

  it('scales with the saved look speed, like the mouse', () => {
    const one = looking(held('ArrowLeft'), 1).yaw;
    const three = looking(held('ArrowLeft'), 3).yaw;
    expect(three).toBeCloseTo(one * 3, 5);
  });

  it('opposite arrows cancel out rather than fighting', () => {
    expect(looking(held('ArrowLeft', 'ArrowRight')).yaw).toBe(0);
  });

  it('still cannot tilt past straight up', () => {
    const player = new Player(1);
    const input = held('ArrowUp');
    const world = flatWorld();
    for (let i = 0; i < 20; i++) player.update(0.5, input, world, 4);
    expect(player.pitch).toBeCloseTo(1.52, 5);
  });
});
