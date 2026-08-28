// The files in public/ are copied to the edge verbatim. Nothing compiles them,
// nothing lints them and nothing renders them, so a typo in robots.txt or a
// stale hostname in the sitemap is invisible until the site drops out of
// search — which is the slowest possible feedback loop.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const SITE = 'https://backrooms.4oli.com';
const html = read('index.html');
const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)![1];

describe('robots.txt', () => {
  const robots = read('public/robots.txt');

  it('lets crawlers in', () => {
    expect(robots).toMatch(/^User-agent:\s*\*/m);
    expect(robots).toMatch(/^Allow:\s*\//m);
    expect(robots).not.toMatch(/^Disallow:\s*\/\s*$/m);
  });

  it('points at a sitemap that is actually shipped', () => {
    const sitemap = /^Sitemap:\s*(\S+)/m.exec(robots);
    expect(sitemap, 'robots.txt names no sitemap').not.toBeNull();
    expect(sitemap![1]).toBe(`${SITE}/sitemap.xml`);
    expect(() => read('public/sitemap.xml')).not.toThrow();
  });
});

describe('sitemap.xml', () => {
  const sitemap = read('public/sitemap.xml');

  it('parses as XML', () => {
    const doc = new DOMParser().parseFromString(sitemap, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.tagName).toBe('urlset');
  });

  it('lists the canonical page and nothing off-site', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    expect(locs).toContain(canonical);
    for (const loc of locs) expect(loc.startsWith(SITE), `${loc} is not on the site`).toBe(true);
  });
});

describe('the hostname', () => {
  it('is the same one everywhere it is written down', () => {
    // Four files hard-code it, and only one of them is ever looked at.
    for (const file of ['public/robots.txt', 'public/sitemap.xml', 'public/llms.txt', 'index.html']) {
      const other = [...read(file).matchAll(/https:\/\/([a-z0-9.-]*4oli\.com)/g)].map((m) => m[1]);
      for (const host of other) expect(host, `${file} points somewhere else`).toBe('backrooms.4oli.com');
    }
  });
});

describe('_headers', () => {
  // A path on its own line opens a block; the indented lines under it are that
  // block's headers. Cloudflare silently ignores anything it cannot parse.
  const blocks = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of read('public/_headers').split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('/')) blocks.set(line.trim(), (current = []));
    else if (current) current.push(line.trim());
    else throw new Error(`a header with no path above it: ${line}`);
  }

  const header = (path: string, name: string): string | undefined =>
    blocks.get(path)?.find((h) => h.toLowerCase().startsWith(`${name.toLowerCase()}:`));

  it('sends nosniff for everything', () => {
    expect(blocks.has('/*')).toBe(true);
    expect(header('/*', 'X-Content-Type-Options')).toMatch(/nosniff/);
  });

  it('caches the fingerprinted assets forever, and nothing else', () => {
    // Vite hashes everything under /assets/; anything else must stay fresh, or
    // a deploy is invisible to anyone who has been here before.
    const immutable = [...blocks].filter(([, hs]) => hs.some((h) => h.includes('immutable')));
    expect(immutable.map(([path]) => path)).toEqual(['/assets/*']);
    expect(header('/assets/*', 'Cache-Control')).toMatch(/max-age=\d{7,}/);
  });

  it('never caches the page itself', () => {
    for (const [path, hs] of blocks) {
      if (path === '/assets/*') continue;
      const cache = hs.find((h) => h.toLowerCase().startsWith('cache-control:'));
      if (!cache) continue;
      const age = /max-age=(\d+)/.exec(cache);
      expect(Number(age?.[1] ?? 0), `${path} is cached for too long`).toBeLessThanOrEqual(86400);
    }
  });

  it('only names rules for files that exist', () => {
    for (const path of blocks.keys()) {
      if (path.includes('*')) continue;
      expect(() => read(`public${path}`), `_headers has a rule for ${path}`).not.toThrow();
    }
  });
});
