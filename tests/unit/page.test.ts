// index.html is hand-written and the game reaches into it by id from thirty
// different modules. TypeScript cannot see across that boundary: every lookup
// ends in a `!`, so a renamed or deleted element compiles perfectly and then
// throws on the first frame of a real player's run.
//
// This test reads the source rather than the DOM on purpose — it is the only
// way to check the two files still agree without booting a browser.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest runs from the project root, and import.meta.url here is a Vite
// /@fs/ URL rather than a path on disk.
const root = process.cwd();
const html = readFileSync(join(root, 'index.html'), 'utf8');
// Parsed rather than assigned to document.body: only a full parse keeps the
// <head> — the meta tags below are half the point of this file.
const doc = new DOMParser().parseFromString(html, 'text/html');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(root, rel)).isDirectory()) sources(rel, out);
    else if (/\.(ts|mjs)$/.test(entry)) out.push(rel);
  }
  return out;
}

/** Every `getElementById('x')` in the codebase, with the file that wants it. */
function lookups(dirs: string[]): { id: string; file: string }[] {
  const found: { id: string; file: string }[] = [];
  for (const dir of dirs) {
    for (const file of sources(dir)) {
      const text = readFileSync(join(root, file), 'utf8');
      for (const m of text.matchAll(/getElementById\('([^']+)'\)/g)) {
        found.push({ id: m[1], file });
      }
    }
  }
  return found;
}

describe('index.html holds everything the game reaches for', () => {
  const wanted = lookups(['src', 'scripts']);

  it('finds more than a handful of lookups to check', () => {
    // A regex that silently stopped matching would make this whole file pass.
    expect(new Set(wanted.map((w) => w.id)).size).toBeGreaterThan(40);
  });

  it.each([...new Set(wanted.map((w) => w.id))].sort())('has #%s', (id) => {
    const asker = wanted.find((w) => w.id === id)!.file;
    expect(doc.getElementById(id), `${asker} looks up #${id}, index.html has not got it`).not.toBeNull();
  });

  it('gives every id to exactly one element', () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });
});

describe('the four screens', () => {
  it.each(['start-screen', 'pause-screen', 'gameover-screen', 'escape-screen'])(
    '%s carries a timecode readout',
    (id) => {
      // tape.ts writes into `.tape-time` inside each screen; a screen without
      // one loses the conceit silently.
      expect(doc.getElementById(id)!.querySelector('.tape-time')).not.toBeNull();
    },
  );

  it('starts with only the landing page showing', () => {
    expect(doc.getElementById('start-screen')!.classList.contains('hidden')).toBe(false);
    for (const id of ['pause-screen', 'gameover-screen', 'escape-screen', 'hud']) {
      expect(doc.getElementById(id)!.classList.contains('hidden'), `${id} is visible at boot`).toBe(true);
    }
  });

  it('hides the resume door until a save says otherwise', () => {
    expect(doc.getElementById('btn-continue')!.classList.contains('hidden')).toBe(true);
  });

  it('gives both doors the label and meta slots main.ts writes into', () => {
    for (const id of ['btn-start', 'btn-continue']) {
      const door = doc.getElementById(id)!;
      expect(door.querySelector('.door-label'), `${id} has no .door-label`).not.toBeNull();
      expect(door.querySelector('.door-meta'), `${id} has no .door-meta`).not.toBeNull();
    }
  });
});

describe('the page a crawler and a share card see', () => {
  const meta = (sel: string): string | null =>
    doc.querySelector(sel)?.getAttribute('content') ?? null;

  it('declares its language and viewport', () => {
    expect(doc.documentElement.getAttribute('lang')).toBe('en');
    expect(meta('meta[name="viewport"]')).toMatch(/width=device-width/);
  });

  it('keeps a title and a description', () => {
    expect(doc.title.length).toBeGreaterThan(10);
    expect(meta('meta[name="description"]')?.length ?? 0).toBeGreaterThan(50);
  });

  it('keeps one canonical URL', () => {
    expect(doc.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(doc.querySelector('link[rel="canonical"]')!.getAttribute('href'))
      .toMatch(/^https:\/\/backrooms\.4oli\.com\//);
  });

  it('keeps the share card fields filled in', () => {
    for (const sel of ['meta[property="og:title"]', 'meta[property="og:description"]',
      'meta[property="og:url"]', 'meta[name="twitter:card"]']) {
      expect(meta(sel), `${sel} is missing or empty`).toMatch(/\S/);
    }
  });

  it('keeps the structured data parseable', () => {
    const blocks = [...doc.querySelectorAll('script[type="application/ld+json"]')];
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const parsed = JSON.parse(block.textContent!);
      expect(parsed['@context']).toBe('https://schema.org');
      expect(parsed['@type']).toMatch(/\S/);
    }
  });

  it('lets itself be indexed', () => {
    expect(meta('meta[name="robots"]') ?? 'index').not.toMatch(/noindex/);
  });

  it('loads the game as a module from source, not a stale built bundle', () => {
    const entry = doc.querySelector('script[type="module"][src]');
    expect(entry).not.toBeNull();
    expect(entry!.getAttribute('src')).toMatch(/main\.ts$/);
  });
});
