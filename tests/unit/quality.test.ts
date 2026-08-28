// Evaluated once, before the first WebGL resource exists, and never revisited.
// Getting it wrong on a phone means rendering four times the pixels the device
// can afford — the game does not crash, it just runs at four frames a second,
// which no error report will ever tell you about.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRenderQuality } from '../../src/rendering/Quality';

function device({ touch, dpr }: { touch: boolean; dpr: number }): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: touch && query.includes('pointer: coarse'),
    media: query,
    addEventListener() {}, removeEventListener() {},
  }));
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: dpr });
}

afterEach(() => vi.unstubAllGlobals());

describe('desktop', () => {
  it('gets the full quality settings', () => {
    device({ touch: false, dpr: 2 });
    expect(getRenderQuality()).toEqual({
      mobile: false,
      antialias: true,
      pixelRatio: 1.75,
      postfxPixelRatio: 1.75,
      shadowMapSize: 1024,
    });
  });

  it('never renders more pixels than the display has', () => {
    device({ touch: false, dpr: 1 });
    const q = getRenderQuality();
    expect(q.pixelRatio).toBe(1);
    expect(q.postfxPixelRatio).toBe(1);
  });
});

describe('a real touchscreen', () => {
  it('caps the pixel ratio, drops antialiasing and halves the shadow map', () => {
    device({ touch: true, dpr: 3 });
    const q = getRenderQuality();
    expect(q.mobile).toBe(true);
    expect(q.antialias).toBe(false);
    expect(q.pixelRatio).toBe(1.25);
    expect(q.postfxPixelRatio).toBe(0.9);
    expect(q.shadowMapSize).toBe(512);
  });

  it('keeps the composer no sharper than the renderer', () => {
    for (const dpr of [1, 1.5, 2, 3, 4]) {
      device({ touch: true, dpr });
      const q = getRenderQuality();
      expect(q.postfxPixelRatio).toBeLessThanOrEqual(q.pixelRatio);
    }
  });
});

describe('whatever the device claims', () => {
  it('never returns a ratio that would be free or ruinous', () => {
    for (const touch of [true, false]) {
      for (const dpr of [0, 1, 2, 4, 8]) {
        device({ touch, dpr });
        const q = getRenderQuality();
        expect(q.pixelRatio).toBeGreaterThan(0);
        expect(q.pixelRatio).toBeLessThanOrEqual(1.75);
        expect(q.postfxPixelRatio).toBeGreaterThan(0);
        expect(q.shadowMapSize % 2).toBe(0);
      }
    }
  });

  it('treats a narrow desktop window as a desktop', () => {
    // A viewport test here would lock a resized window into phone quality for
    // the whole run; only a coarse pointer counts.
    device({ touch: false, dpr: 2 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 380 });
    expect(getRenderQuality().mobile).toBe(false);
  });
});
