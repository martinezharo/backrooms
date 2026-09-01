// The Worker is the only server this game has, it is on the public internet,
// and every byte it sees is attacker-controlled. It has to be strict about
// what it accepts, cheap about what it reads, and it must never widen the
// promise made on the landing page: nothing but an event name, a floor, a
// clock and an input mode, plus the country Cloudflare puts on the request.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exports } from 'cloudflare:workers';
import worker, { MAX_DEPTH } from '../../worker/index';

type DataPoint = { blobs?: unknown[]; doubles?: number[]; indexes?: string[] };

let written: DataPoint[];
let env: { GAME_ANALYTICS: { writeDataPoint: (p: DataPoint) => void } };

beforeEach(() => {
  written = [];
  env = { GAME_ANALYTICS: { writeDataPoint: (p) => { written.push(p); } } };
});

const ENDPOINT = 'https://backrooms.4oli.com/api/telemetry';

function post(
  body: unknown,
  init: { cf?: unknown; raw?: string; headers?: Record<string, string>; url?: string } = {},
): Request {
  const { cf, raw, headers, url } = init;
  const request = new Request(url ?? ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: raw ?? JSON.stringify(body),
  });
  if (cf !== undefined) Object.defineProperty(request, 'cf', { value: cf });
  return request;
}

const valid = { event: 'game_started', depth: 0, seconds: 12, input: 'keyboard' };

const send = (request: Request) => worker.fetch(request, env as unknown as Env);

describe('routing', () => {
  it('runs through the configured Worker export and Analytics Engine binding', async () => {
    const res = await exports.default.fetch(post(valid));
    expect(res.status).toBe(204);
  });

  it('accepts a well-formed event with no content at all', async () => {
    const res = await send(post(valid));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it.each(['/', '/index.html', '/api/', '/api/telemetry/', '/api/telemetryx', '/API/TELEMETRY'])(
    'has nothing to say about %s',
    async (path) => {
      const res = await send(new Request(new URL(path, ENDPOINT), { method: 'POST' }));
      expect(res.status).toBe(404);
    },
  );

  it.each(['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD'])('refuses %s and says what it takes', async (method) => {
    const res = await send(new Request(ENDPOINT, { method }));
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
  });

  it('routes on the path alone, whatever the query string says', async () => {
    const res = await send(post(valid, { url: `${ENDPOINT}?seed=1234&telemetry=on` }));
    expect(res.status).toBe(204);
  });
});

describe('the content type', () => {
  it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', ''])(
    'refuses %s',
    async (type) => {
      const res = await send(post(valid, { headers: { 'content-type': type } }));
      expect(res.status).toBe(415);
    },
  );

  it('refuses a request with no content type at all', async () => {
    const request = new Request(ENDPOINT, { method: 'POST', body: JSON.stringify(valid) });
    request.headers.delete('content-type');
    expect((await send(request)).status).toBe(415);
  });

  it('accepts the charset browsers tack on', async () => {
    const res = await send(post(valid, { headers: { 'content-type': 'Application/JSON; charset=utf-8' } }));
    expect(res.status).toBe(204);
  });
});

describe('the body it agrees to read', () => {
  it('refuses an oversized body on the declared length alone', async () => {
    const res = await send(post(valid, { headers: { 'content-length': '99999' } }));
    expect(res.status).toBe(413);
    expect(written).toHaveLength(0);
  });

  it('refuses an oversized body that lied about its length', async () => {
    // The point of the streaming cap: a chunked body has no content-length to
    // check, so the reader has to stop counting on its own.
    const big = new TextEncoder().encode(JSON.stringify({ ...valid, pad: 'x'.repeat(4096) }));
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < big.length; i += 64) controller.enqueue(big.slice(i, i + 64));
        controller.close();
      },
    });
    const request = new Request(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
    });
    const res = await send(request);
    expect(res.status).toBe(413);
    expect(written).toHaveLength(0);
  });

  it('refuses a POST with no body', async () => {
    const res = await send(new Request(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }));
    expect(res.status).toBe(400);
  });

  it.each([
    ['truncated', '{"event":'],
    ['not JSON', 'hello'],
    ['empty', ''],
  ])('refuses a %s body', async (_label, raw) => {
    expect((await send(post(null, { raw }))).status).toBe(400);
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a number', '7'],
    ['a string', '"game_started"'],
  ])('refuses %s as an event', async (_label, raw) => {
    expect((await send(post(null, { raw }))).status).toBe(400);
  });
});

describe('the fields', () => {
  it.each(['game_started', 'engaged_session', 'level_reached', 'death', 'escape'])(
    'accepts the %s event the client actually sends',
    async (event) => {
      expect((await send(post({ ...valid, event }))).status).toBe(204);
    },
  );

  it.each(['', 'GAME_STARTED', 'purchase', 'game_started ', '__proto__', 'constructor'])(
    'refuses %j as an event name',
    async (event) => {
      const res = await send(post({ ...valid, event }));
      expect(res.status).toBe(400);
      expect(written).toHaveLength(0);
    },
  );

  it.each(Array.from({ length: MAX_DEPTH + 1 }, (_, depth) => depth))('accepts depth %d', async (depth) => {
    expect((await send(post({ ...valid, depth }))).status).toBe(204);
  });

  it.each([-1, MAX_DEPTH + 1, MAX_DEPTH + 94, 2.5, NaN, Infinity, null, '3'])(
    'refuses depth %j',
    async (depth) => {
      const res = await send(post({ ...valid, depth }));
      expect(res.status).toBe(400);
      expect(written).toHaveLength(0);
    },
  );

  it.each([0, 0.4, 3600, 86400])('accepts %d seconds of play', async (seconds) => {
    expect((await send(post({ ...valid, seconds }))).status).toBe(204);
  });

  it.each([-1, 86401, NaN, Infinity, -Infinity, null, '60'])('refuses %j seconds', async (seconds) => {
    const res = await send(post({ ...valid, seconds }));
    expect(res.status).toBe(400);
    expect(written).toHaveLength(0);
  });

  it.each(['keyboard', 'touch'])('accepts the %s input mode', async (input) => {
    expect((await send(post({ ...valid, input }))).status).toBe(204);
  });

  it.each(['gamepad', '', 'KEYBOARD', null, 1])('refuses %j as an input mode', async (input) => {
    expect((await send(post({ ...valid, input }))).status).toBe(400);
  });

  it('ignores anything else the body carries', async () => {
    const res = await send(post({ ...valid, seed: 1234, save: 'x', ip: '1.2.3.4' }));
    expect(res.status).toBe(204);
    expect(JSON.stringify(written)).not.toMatch(/1234|1\.2\.3\.4/);
  });
});

describe('what it records', () => {
  it('writes one point in the documented shape', async () => {
    await send(post(
      { event: 'escape', depth: MAX_DEPTH, seconds: 640, input: 'touch' },
      { cf: { country: 'ES' } },
    ));
    expect(written).toHaveLength(1);
    expect(written[0]).toEqual({
      blobs: ['escape', 'ES', 'touch'],
      doubles: [1, MAX_DEPTH, 640],
      indexes: ['ES:escape'],
    });
  });

  it('rounds the clock to a whole second', async () => {
    await send(post({ ...valid, seconds: 12.7 }));
    expect(written[0].doubles![2]).toBe(13);
  });

  it('takes the country from Cloudflare, never from the body or a header', async () => {
    await send(post({ ...valid, country: 'ZZ' }, {
      cf: { country: 'de' },
      headers: { 'content-type': 'application/json', 'cf-ipcountry': 'JP' },
    }));
    expect(written[0].blobs![1]).toBe('DE');
  });

  it.each([
    ['no cf object at all', undefined],
    ['no country on it', {}],
    ['a country that is not one', { country: 'XYZ' }],
    ['a non-string country', { country: 42 }],
    ['an empty country', { country: '' }],
  ])('falls back to XX when the edge gives it %s', async (_label, cf) => {
    await send(post(valid, cf === undefined ? {} : { cf }));
    expect(written[0].blobs![1]).toBe('XX');
    expect(written[0].indexes![0]).toBe('XX:game_started');
  });

  it('records nothing at all for a request it refused', async () => {
    await send(post({ ...valid, event: 'nope' }));
    await send(new Request(ENDPOINT, { method: 'GET' }));
    await send(post(null, { raw: 'x' }));
    expect(written).toHaveLength(0);
  });

  it('stores no IP, no identifier and nothing free-form', async () => {
    await send(post(valid, {
      cf: { country: 'ES' },
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.7',
        'user-agent': 'Mozilla/5.0 (a very identifying string)',
        cookie: 'id=abc123',
        referer: 'https://example.com/?seed=1234',
      },
    }));
    const text = JSON.stringify(written);
    expect(text).not.toMatch(/203\.0\.113\.7|Mozilla|abc123|example\.com|1234/);
    expect(written[0].blobs).toHaveLength(3);
  });
});

describe('when the analytics binding is unhappy', () => {
  it('answers 503 rather than leaking a stack trace', async () => {
    const noise = vi.spyOn(console, 'error').mockImplementation(() => {});
    env.GAME_ANALYTICS.writeDataPoint = () => { throw new Error('dataset on fire'); };
    const res = await send(post(valid));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toMatch(/on fire/);
    noise.mockRestore();
  });
});

describe('caching', () => {
  it.each([
    ['a success', () => post(valid), 204],
    ['a rejection', () => post({ ...valid, event: 'nope' }), 400],
    ['a wrong method', () => new Request(ENDPOINT, { method: 'GET' }), 405],
  ])('tells the edge not to cache %s', async (_label, make, status) => {
    const res = await send(make());
    expect(res.status).toBe(status);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
