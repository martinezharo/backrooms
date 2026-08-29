// Wheel and arrow-key handling — the two places a laptop without a mouse used
// to come off worst.
//
// The wheel is the interesting one: a mouse reports one notch as one large
// event, a touchpad reports the same gesture as a long drizzle of small ones
// plus a second of momentum after the fingers have left. Counting events
// instead of distance meant one flick cycled the whole inventory.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../../src/core/Input';

let input: Input;

/** `deltaMode` 0 is pixels, 1 is lines, 2 is pages. */
function wheel(deltaY: number, deltaMode = 0): void {
  window.dispatchEvent(new WheelEvent('wheel', { deltaY, deltaMode }));
}

function glide(events: number, pxEach: number): void {
  for (let i = 0; i < events; i++) wheel(pxEach);
}

/**
 * One Input for the whole file. It listens on `window` and has no way to let
 * go, so a second instance would see — and preventDefault — every event too.
 * Fake timers for the whole file as well: the rate limit reads a clock that
 * would otherwise restart under it between tests.
 */
beforeAll(() => {
  vi.useFakeTimers();
  input = new Input(document.createElement('canvas'));
});

afterAll(() => vi.useRealTimers());

beforeEach(() => {
  vi.advanceTimersByTime(1000); // past whatever the last test rate-limited
  input.pointerLocked = true;
  wheel(1000); // a notch banks nothing, so this clears the last test's glide
  window.dispatchEvent(new Event('blur')); // and its held keys
  input.endFrame();
});

describe('wheel — a mouse', () => {
  it('turns one notch into exactly one step', () => {
    wheel(100);
    expect(input.wheelDelta).toBe(1);
  });

  it('keeps up with a fast spin, one step per notch', () => {
    for (let i = 0; i < 10; i++) wheel(100);
    expect(input.wheelDelta).toBe(10);
  });

  it('counts a notch up as a step the other way', () => {
    wheel(-100);
    expect(input.wheelDelta).toBe(-1);
  });

  it.each([
    ['lines', 3, 1],
    ['pages', 1, 2],
  ])('reads a notch reported in %s as one step', (_label, deltaY, deltaMode) => {
    wheel(deltaY, deltaMode);
    expect(input.wheelDelta).toBe(1);
  });
});

describe('wheel — a touchpad', () => {
  it('does not spend a step on a nudge too small to mean one', () => {
    glide(10, 3);
    expect(input.wheelDelta).toBe(0);
  });

  it('spends one step once the fingers have travelled far enough', () => {
    glide(30, 3);
    expect(input.wheelDelta).toBe(1);
  });

  it('does not cycle the inventory on one flick and its momentum tail', () => {
    glide(200, 4); // 800 px, well past several thresholds
    expect(input.wheelDelta).toBe(1);
  });

  it('lets a deliberate second gesture through once the tail has died', () => {
    glide(30, 3);
    vi.advanceTimersByTime(200);
    glide(30, 3);
    expect(input.wheelDelta).toBe(2);
  });

  it('keeps a hard flick whole when its momentum outgrows a notch', () => {
    // ramp up the way a real flick does, then throw events a mouse's size
    for (const px of [2, 6, 14, 30, 60, 90, 70, 50, 30, 12, 4]) wheel(px);
    expect(input.wheelDelta).toBe(1);
  });

  it('lets go of the gesture once the events stop', () => {
    glide(30, 3);
    vi.advanceTimersByTime(200);
    wheel(100); // a mouse notch after the tail has died is still a notch
    expect(input.wheelDelta).toBe(2);
  });

  it('does not add up a gesture and the one that reverses it', () => {
    glide(15, 4);
    glide(15, -4);
    expect(input.wheelDelta).toBe(0);
  });
});

describe('wheel — housekeeping', () => {
  it('ignores the wheel when the pointer is not locked', () => {
    input.pointerLocked = false;
    wheel(100);
    expect(input.wheelDelta).toBe(0);
  });

  it('clears the steps at the end of the frame', () => {
    wheel(100);
    input.endFrame();
    expect(input.wheelDelta).toBe(0);
  });
});

describe('arrow keys', () => {
  it.each(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])('reports %s as held', (code) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    expect(input.down(code)).toBe(true);
  });

  it('keeps the page from scrolling out from under a locked pointer', () => {
    const e = new KeyboardEvent('keydown', { code: 'ArrowDown', cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('leaves the page alone when the game does not have the pointer', () => {
    input.pointerLocked = false;
    const e = new KeyboardEvent('keydown', { code: 'ArrowDown', cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
