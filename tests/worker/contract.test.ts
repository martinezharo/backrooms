// The game and the Worker are two bundles compiled against two tsconfigs, and
// nothing type-checks the wire between them. Adding a level or a telemetry
// event on one side and not the other does not fail to build, does not throw
// at runtime and does not show up anywhere a player can see — the events are
// simply rejected at the edge and the dashboard quietly goes flat.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENTS, INPUT_MODES, MAX_BODY_BYTES, MAX_DEPTH, TELEMETRY_PATH } from '../../worker/constants';

const root = process.cwd();
const client = readFileSync(join(root, 'src/core/Telemetry.ts'), 'utf8');
const biomes = readFileSync(join(root, 'src/world/Biomes.ts'), 'utf8');

/** The members of a string-literal union, read off the client's own source. */
function union(name: string): string[] {
  const decl = new RegExp(`type ${name} =([^;]+);`).exec(client);
  if (!decl) throw new Error(`the client no longer declares a ${name} union`);
  return [...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('the events', () => {
  it('is reading a union that still exists', () => {
    expect(union('TelemetryEvent').length).toBeGreaterThan(0);
    expect(union('InputMode').length).toBeGreaterThan(0);
  });

  it('accepts exactly the events the game can send', () => {
    expect([...EVENTS].sort()).toEqual(union('TelemetryEvent').sort());
  });

  it('accepts exactly the input modes the game can report', () => {
    expect([...INPUT_MODES].sort()).toEqual(union('InputMode').sort());
  });
});

describe('the depth range', () => {
  it('reaches the bottom of the building', () => {
    // DEPTHS is the descent, one entry per floor; the deepest index is one less.
    const depths = /export const DEPTHS: BiomeId\[\] = \[([^\]]+)\]/.exec(biomes);
    expect(depths, 'DEPTHS has moved or been renamed').not.toBeNull();
    const floors = depths![1].split(',').filter((s) => s.trim()).length;
    expect(floors).toBeGreaterThan(0);
    expect(MAX_DEPTH).toBe(floors - 1);
  });
});

describe('the endpoint', () => {
  it('is the path the client posts to', () => {
    expect(client).toContain(`'${TELEMETRY_PATH}'`);
  });

  it('is the path the Worker is put in front of the assets for', () => {
    const wrangler = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
    const prefix = TELEMETRY_PATH.replace(/\/[^/]+$/, '/*');
    expect(wrangler, `run_worker_first must cover ${prefix}`).toContain(`"${prefix}"`);
  });
});

describe('the body cap', () => {
  it('is comfortably bigger than the biggest event the client can build', () => {
    const biggest = JSON.stringify({
      event: [...EVENTS].reduce((a, b) => (a.length > b.length ? a : b)),
      depth: MAX_DEPTH,
      seconds: 86400,
      input: [...INPUT_MODES].reduce((a, b) => (a.length > b.length ? a : b)),
    });
    expect(biggest.length).toBeLessThan(MAX_BODY_BYTES / 2);
  });
});
