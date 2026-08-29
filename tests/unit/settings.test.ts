// The look-speed knob. It is read every frame and written by a slider anyone
// can drag to either end, so out-of-range and outright junk both have to land
// somewhere sane rather than turning the camera into a blur or a NaN.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withBrokenStorage } from '../helpers/storage';

const KEY = 'backrooms.settings.v1';

type SettingsModule = typeof import('../../src/core/Settings');

/** Settings caches in module scope on purpose — every test needs a fresh one. */
async function fresh(): Promise<SettingsModule> {
  vi.resetModules();
  return import('../../src/core/Settings');
}

beforeEach(() => localStorage.clear());

describe('loadSettings', () => {
  it('starts at the mouse default', async () => {
    const { loadSettings } = await fresh();
    expect(loadSettings()).toEqual({ lookSpeed: 1 });
  });

  it('reads back what was stored', async () => {
    localStorage.setItem(KEY, JSON.stringify({ lookSpeed: 2.5 }));
    const { loadSettings } = await fresh();
    expect(loadSettings().lookSpeed).toBe(2.5);
  });

  it.each([
    ['above the top of the slider', 99, 4],
    ['below the bottom of it', 0, 0.4],
  ])('pulls a value %s back in range', async (_label, stored, expected) => {
    localStorage.setItem(KEY, JSON.stringify({ lookSpeed: stored }));
    const { loadSettings } = await fresh();
    expect(loadSettings().lookSpeed).toBe(expected);
  });

  it.each([
    ['truncated JSON', '{"lookSpeed":'],
    ['not JSON at all', 'nope'],
    ['a value that is not a number', '{"lookSpeed":"fast"}'],
    ['a missing field', '{}'],
  ])('falls back to the default on %s', async (_label, body) => {
    localStorage.setItem(KEY, body);
    const { loadSettings } = await fresh();
    expect(loadSettings().lookSpeed).toBe(1);
  });

  it('survives a browser with no storage', async () => {
    const { loadSettings } = await fresh();
    withBrokenStorage(() => {
      expect(loadSettings().lookSpeed).toBe(1);
    });
  });
});

describe('setLookSpeed', () => {
  it('writes through and reports what it stored', async () => {
    const { loadSettings, setLookSpeed } = await fresh();
    expect(setLookSpeed(2.2)).toBe(2.2);
    expect(loadSettings().lookSpeed).toBe(2.2);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ lookSpeed: 2.2 });
  });

  it('reports the clamped value, so the slider can snap to it', async () => {
    const { setLookSpeed } = await fresh();
    expect(setLookSpeed(12)).toBe(4);
  });

  it('keeps the change for the session when there is nowhere to write it', async () => {
    const { loadSettings, setLookSpeed } = await fresh();
    withBrokenStorage(() => {
      expect(setLookSpeed(3)).toBe(3);
      expect(loadSettings().lookSpeed).toBe(3);
    });
  });
});
