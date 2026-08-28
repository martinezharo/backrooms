// The checkpoint is the only thing standing between a player and losing an
// hour. It also has to refuse a save it cannot honour: a v1 save describes a
// world this build no longer generates, and resuming into it would drop the
// player inside geometry that is not there.

import { beforeEach, describe, expect, it } from 'vitest';
import { clearSave, loadSave, writeSave } from '../../src/core/Save';
import { aSave } from '../helpers/fixtures';
import { withBrokenStorage } from '../helpers/storage';

const KEY = 'backrooms.save.v1';
const raw = (): string | null => localStorage.getItem(KEY);

beforeEach(() => localStorage.clear());

describe('writeSave / loadSave', () => {
  it('round-trips every field of a run', () => {
    const input = aSave();
    expect(writeSave(input)).toBe(true);
    const back = loadSave()!;
    expect(back).not.toBeNull();
    for (const key of Object.keys(input) as (keyof typeof input)[]) {
      expect(back[key], `field ${key} did not survive the round trip`).toEqual(input[key]);
    }
  });

  it('stamps the version and a timestamp', () => {
    const before = Date.now();
    writeSave(aSave());
    const back = loadSave()!;
    expect(back.v).toBe(2);
    expect(back.savedAt).toBeGreaterThanOrEqual(before);
  });

  it('overwrites rather than accumulating checkpoints', () => {
    writeSave(aSave({ torchCharge: 10 }));
    writeSave(aSave({ torchCharge: 20 }));
    expect(loadSave()!.torchCharge).toBe(20);
    expect(Object.keys(localStorage)).toEqual([KEY]);
  });

  it('has nothing to offer on a clean slate', () => {
    expect(loadSave()).toBeNull();
  });
});

describe('loadSave refuses what it cannot honour', () => {
  it('drops a save from an older world layout', () => {
    localStorage.setItem(KEY, JSON.stringify({ ...aSave(), v: 1, savedAt: Date.now() }));
    expect(loadSave()).toBeNull();
  });

  it('drops a save from a future build', () => {
    localStorage.setItem(KEY, JSON.stringify({ ...aSave(), v: 99, savedAt: Date.now() }));
    expect(loadSave()).toBeNull();
  });

  it('drops a save with no version at all', () => {
    localStorage.setItem(KEY, JSON.stringify(aSave()));
    expect(loadSave()).toBeNull();
  });

  it.each([
    ['truncated JSON', '{"v":2,"seed":1'],
    ['not JSON at all', 'nope'],
    ['a bare null', 'null'],
    ['an array', '[]'],
    ['a number', '7'],
  ])('survives %s without throwing', (_label, body) => {
    localStorage.setItem(KEY, body);
    expect(() => loadSave()).not.toThrow();
    expect(loadSave()).toBeNull();
  });

  it.each([
    ['seed', { seed: 'abc' }],
    ['seed (null)', { seed: null }],
    ['player', { player: undefined }],
    ['descent', { descent: undefined }],
  ])('drops a save with a broken %s', (_label, over) => {
    localStorage.setItem(KEY, JSON.stringify({ ...aSave(), ...over, v: 2, savedAt: Date.now() }));
    expect(loadSave()).toBeNull();
  });
});

describe('clearSave', () => {
  it('leaves nothing behind for the landing page to offer', () => {
    writeSave(aSave());
    expect(raw()).not.toBeNull();
    clearSave();
    expect(raw()).toBeNull();
    expect(loadSave()).toBeNull();
  });

  it('is safe to call with nothing saved', () => {
    expect(() => clearSave()).not.toThrow();
  });
});

describe('a browser with no storage to give', () => {
  it('says so instead of throwing, so the pause screen can tell the player', () => {
    withBrokenStorage(() => {
      expect(writeSave(aSave())).toBe(false);
      expect(loadSave()).toBeNull();
      expect(() => clearSave()).not.toThrow();
    });
  });
});
