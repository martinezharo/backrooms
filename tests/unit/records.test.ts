// The only thing a player keeps between runs. It is also the one blob that is
// read on the landing page before anything else exists, so a shape it cannot
// cope with is a white screen rather than a missing line of text.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withBrokenStorage } from '../helpers/storage';

const KEY = 'backrooms.records.v1';

type RecordsModule = typeof import('../../src/core/Records');

/** Records caches in module scope on purpose — every test needs a fresh one. */
async function fresh(): Promise<RecordsModule> {
  vi.resetModules();
  return import('../../src/core/Records');
}

beforeEach(() => localStorage.clear());

describe('loadRecords', () => {
  it('starts everything at zero', async () => {
    const { loadRecords } = await fresh();
    expect(loadRecords()).toEqual({
      runs: 0, escapes: 0, bestSeconds: null, bestFuses: 0, deepest: 0, deepestLevel: 0,
    });
  });

  it('fills in fields a older build never wrote', async () => {
    localStorage.setItem(KEY, JSON.stringify({ runs: 4, escapes: 1 }));
    const { loadRecords } = await fresh();
    expect(loadRecords()).toEqual({
      runs: 4, escapes: 1, bestSeconds: null, bestFuses: 0, deepest: 0, deepestLevel: 0,
    });
  });

  it.each([
    ['truncated JSON', '{"runs":'],
    ['not JSON at all', 'nope'],
  ])('falls back to a blank sheet on %s', async (_label, body) => {
    localStorage.setItem(KEY, body);
    const { loadRecords } = await fresh();
    expect(loadRecords().runs).toBe(0);
  });

  it('reads storage once and keeps the copy', async () => {
    localStorage.setItem(KEY, JSON.stringify({ runs: 3 }));
    const { loadRecords } = await fresh();
    expect(loadRecords().runs).toBe(3);
    localStorage.setItem(KEY, JSON.stringify({ runs: 99 }));
    expect(loadRecords().runs).toBe(3);
  });
});

describe('counting a run', () => {
  it('adds one descent and persists it', async () => {
    const { noteRunStarted, loadRecords } = await fresh();
    noteRunStarted();
    noteRunStarted();
    expect(loadRecords().runs).toBe(2);
    expect(JSON.parse(localStorage.getItem(KEY)!).runs).toBe(2);
  });
});

describe('noteDepth', () => {
  it('only writes when you actually got further', async () => {
    const { noteDepth, loadRecords } = await fresh();
    noteDepth(40);
    expect(loadRecords().deepest).toBe(40);
    noteDepth(40.5);
    expect(loadRecords().deepest).toBe(40);
    noteDepth(60);
    expect(loadRecords().deepest).toBe(60);
  });

  it('never walks the record backwards', async () => {
    const { noteDepth, loadRecords } = await fresh();
    noteDepth(100);
    noteDepth(3);
    expect(loadRecords().deepest).toBe(100);
  });
});

describe('noteLevel', () => {
  it('keeps the lowest floor ever reached', async () => {
    const { noteLevel, loadRecords } = await fresh();
    noteLevel(3);
    expect(loadRecords().deepestLevel).toBe(3);
    noteLevel(1);
    expect(loadRecords().deepestLevel).toBe(3);
    noteLevel(5);
    expect(loadRecords().deepestLevel).toBe(5);
  });
});

describe('noteEscape', () => {
  it('counts the escape and keeps the best of each measure', async () => {
    const { noteEscape } = await fresh();
    expect(noteEscape(2, 400)).toMatchObject({ escapes: 1, bestFuses: 2, bestSeconds: 400 });
    // slower but with more fuses: each record moves on its own
    expect(noteEscape(3, 900)).toMatchObject({ escapes: 2, bestFuses: 3, bestSeconds: 400 });
    expect(noteEscape(1, 120)).toMatchObject({ escapes: 3, bestFuses: 3, bestSeconds: 120 });
  });

  it('returns the same records the next read gets', async () => {
    const { noteEscape, loadRecords } = await fresh();
    expect(noteEscape(3, 250)).toEqual(loadRecords());
  });
});

describe('formatTime', () => {
  it.each([
    [0, '0m 00s'],
    [9, '0m 09s'],
    [59.9, '0m 59s'],
    [60, '1m 00s'],
    [125, '2m 05s'],
    [3600, '60m 00s'],
  ])('renders %d seconds as %s', async (seconds, expected) => {
    const { formatTime } = await fresh();
    expect(formatTime(seconds)).toBe(expected);
  });
});

describe('a browser with no storage to give', () => {
  it('keeps the run history in memory for the session instead of throwing', async () => {
    const mod = await fresh();
    withBrokenStorage(() => {
      expect(() => mod.noteRunStarted()).not.toThrow();
      expect(mod.loadRecords().runs).toBe(1);
      expect(() => mod.noteEscape(3, 100)).not.toThrow();
      expect(mod.loadRecords().escapes).toBe(1);
    });
  });
});
