// Telemetry is the one thing in the game that talks to a server, and the
// promise made in the README and on the landing page is specific: no seed, no
// save, no identifier, nothing at all from a browser that opted out. A
// regression here is a privacy incident, not a bug.

import { beforeEach, describe, expect, it, vi } from 'vitest';

type TelemetryModule = typeof import('../../src/core/Telemetry');

let now = 0;
let fetchMock: ReturnType<typeof vi.fn>;

async function fresh(search = ''): Promise<TelemetryModule> {
  history.replaceState(null, '', `/${search}`);
  vi.resetModules();
  return import('../../src/core/Telemetry');
}

/** Every body this instance posted, parsed. */
function bodies(): Record<string, unknown>[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

beforeEach(() => {
  localStorage.clear();
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: null });
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: undefined });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('what it sends', () => {
  it('posts one JSON event to the telemetry endpoint', async () => {
    const { Telemetry } = await fresh();
    new Telemetry(true).record('game_started', 0, 0, 'keyboard');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/telemetry');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    // no cookies, so nothing that could identify the browser rides along
    expect(init.credentials).toBe('omit');
  });

  it('sends exactly the four fields the Worker accepts, and nothing else', async () => {
    const { Telemetry } = await fresh('?seed=1234');
    new Telemetry(true).record('level_reached', 3, 61.4, 'touch');

    expect(bodies()[0]).toEqual({ event: 'level_reached', depth: 3, seconds: 61, input: 'touch' });
  });

  it('never leaks the seed, the save or anything from storage', async () => {
    localStorage.setItem('backrooms.save.v1', JSON.stringify({ seed: 1234 }));
    const { Telemetry } = await fresh('?seed=987654');
    const t = new Telemetry(true);
    t.record('game_started', 0, 0, 'keyboard');
    t.record('death', 2, 90, 'keyboard');

    for (const body of bodies()) {
      const text = JSON.stringify(body);
      expect(text).not.toMatch(/987654|1234|seed|save/i);
      expect(Object.keys(body).sort()).toEqual(['depth', 'event', 'input', 'seconds']);
    }
  });

  it('rounds the clock to whole seconds', async () => {
    const { Telemetry } = await fresh();
    new Telemetry(true).record('death', 1, 12.7, 'keyboard');
    expect(bodies()[0].seconds).toBe(13);
  });

  it('never throws when the network refuses it', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { Telemetry } = await fresh();
    expect(() => new Telemetry(true).record('death', 0, 1, 'keyboard')).not.toThrow();
  });
});

describe('what it sends once', () => {
  it('does not repeat an event', async () => {
    const { Telemetry } = await fresh();
    const t = new Telemetry(true);
    t.record('game_started', 0, 0, 'keyboard');
    t.record('game_started', 0, 5, 'keyboard');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('counts each floor once, but every floor', async () => {
    const { Telemetry } = await fresh();
    const t = new Telemetry(true);
    t.level(1, 10, 'keyboard');
    t.level(1, 20, 'keyboard');
    t.level(2, 30, 'keyboard');
    expect(bodies().map((b) => b.depth)).toEqual([1, 2]);
  });
});

describe('who it refuses to speak for', () => {
  it('says nothing when the run did not start with a real click', async () => {
    const { Telemetry } = await fresh();
    new Telemetry(false).record('game_started', 0, 0, 'keyboard');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('respects Do Not Track', async () => {
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' });
    const { Telemetry } = await fresh();
    new Telemetry(true).record('game_started', 0, 0, 'keyboard');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('respects Global Privacy Control', async () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
    const { Telemetry } = await fresh();
    new Telemetry(true).record('game_started', 0, 0, 'keyboard');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('remembers ?telemetry=off across later visits', async () => {
    let mod = await fresh('?telemetry=off');
    new mod.Telemetry(true).record('game_started', 0, 0, 'keyboard');
    expect(fetchMock).not.toHaveBeenCalled();

    mod = await fresh();            // came back without the parameter
    new mod.Telemetry(true).record('game_started', 0, 0, 'keyboard');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets ?telemetry=on undo it', async () => {
    let mod = await fresh('?telemetry=off');
    new mod.Telemetry(true);
    mod = await fresh('?telemetry=on');
    new mod.Telemetry(true).record('game_started', 0, 0, 'keyboard');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('the engaged-session heuristic', () => {
  const walk = (t: InstanceType<TelemetryModule['Telemetry']>, seconds: number, metres: number) => {
    const steps = 100;
    for (let i = 1; i <= steps; i++) {
      now += (seconds / steps) * 1000;
      t.update((metres / steps) * i, 0, true, true, 0, i, 'keyboard');
    }
  };

  it('needs both the time on screen and the distance walked', async () => {
    const { Telemetry } = await fresh();
    const t = new Telemetry(true);
    walk(t, 60, 2);                          // long enough, barely moved
    expect(fetchMock).not.toHaveBeenCalled();

    const still = new Telemetry(true);
    walk(still, 10, 40);                     // moved plenty, not long enough
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fires once a real session is under way, and only once', async () => {
    const { Telemetry } = await fresh();
    const t = new Telemetry(true);
    walk(t, 60, 20);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodies()[0].event).toBe('engaged_session');
    walk(t, 60, 20);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not count time spent on another tab', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const { Telemetry } = await fresh();
    const t = new Telemetry(true);
    walk(t, 300, 100);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not count time spent paused or on a menu', async () => {
    const { Telemetry } = await fresh();
    const t = new Telemetry(true);
    for (let i = 1; i <= 100; i++) {
      now += 3000;
      t.update(i, 0, false, false, 0, i, 'keyboard');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not count a teleport between floors as distance walked', async () => {
    const { Telemetry } = await fresh();
    const t = new Telemetry(true);
    // 60 s on screen, and every "step" is a 500 m jump: none of it counts
    for (let i = 1; i <= 100; i++) {
      now += 600;
      t.update(i * 500, 0, true, true, 0, i, 'keyboard');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cannot be run up by a tab left open for an hour in one frame', async () => {
    const { Telemetry } = await fresh();
    const t = new Telemetry(true);
    now += 3_600_000;                         // one frame, one hour of wall clock
    t.update(1, 0, true, true, 0, 1, 'keyboard');
    now += 3_600_000;
    t.update(2, 0, true, true, 0, 2, 'keyboard');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
