// Shared plumbing for the headless checks.
//
// The scripts under scripts/ started life as probes you read the output of.
// Anything CI runs has to do more than print: it has to decide. This gives all
// of them the same launch flags, the same error collection and the same
// pass/fail verdict, so a broken level fails the build instead of scrolling
// past in a log.

import puppeteer from 'puppeteer';

/** Where the game is. The e2e runner serves a build and overrides this. */
export function gameUrl(fallback = 'http://localhost:5199', query = '?seed=1234') {
  const base = process.argv[2] ?? process.env.GAME_URL ?? fallback;
  if (base.includes('?')) return base;
  return `${base.replace(/\/$/, '')}/${query}`;
}

export function launch(viewport = { width: 1280, height: 800 }) {
  return puppeteer.launch({
    headless: true,
    args: [
      // The CI runner has no GPU; SwiftShader is what makes WebGL work at all.
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--no-sandbox',
      `--window-size=${viewport.width},${viewport.height}`,
    ],
    defaultViewport: viewport,
  });
}

/** Collect everything the page complains about, for the verdict to weigh. */
export function watch(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  return errors;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The game only exposes `window.__game` in a build with the dev hacks on. A
 * check that quietly did nothing because it was pointed at a production bundle
 * is worse than one that fails, so say so out loud.
 */
export async function waitForGame(page, timeout = 30000) {
  await page.waitForFunction(() => !!window.__game, { timeout, polling: 200 })
    .catch(() => {
      throw new Error(
        'window.__game never appeared — is this a build with VITE_HACKS=dev?',
      );
    });
}

/**
 * Print the verdict and set the exit code. `checks` is a plain object of
 * name -> boolean; console errors always count against it.
 */
export function report(name, checks, errors = []) {
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  for (const [key, ok] of Object.entries(checks)) console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${key}`);
  if (errors.length) {
    console.log(`  FAIL no console errors (${errors.length})`);
    for (const e of errors.slice(0, 15)) console.log(`       ${e}`);
    failed.push('consoleErrors');
  }
  if (failed.length) {
    console.log(`${name}: FAILED — ${failed.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`${name}: PASS`);
  }
  return failed.length === 0;
}
