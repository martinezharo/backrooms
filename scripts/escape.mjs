// Headless run of a full extraction: jumps to the exit portal, feeds it three
// fuses, steps through and shoots the fall at fixed points of the sequence.
// The ending is the one sequence a player only ever sees once, so it is also
// the one nobody notices has broken.
//
// Usage: node scripts/escape.mjs [url]

import { gameUrl, launch, report, wait, watch, waitForGame } from './lib/check.mjs';

const url = gameUrl();
const out = process.env.SHOT_DIR ?? '/tmp';

const browser = await launch();
const page = await browser.newPage();
const errors = watch(page);

await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-start');
await waitForGame(page);
await page.waitForFunction(() => window.__game.state === 'playing',
  { timeout: 30000, polling: 200 });
await wait(2500);

const placed = await page.evaluate(() => {
  const g = window.__game;
  const ok = g.teleportToExit(3);
  const p = g.portals.portal;
  return {
    ok,
    onLastFloor: g.currentDepth().depth === 5,
    fuses: g.inventory.items.filter((i) => i.item.def.id === 'fuse').length,
    onWall: p?.spot.onWall,
    centre: p && [p.center.x, p.center.y, p.center.z],
  };
});
console.log('portal:', JSON.stringify(placed));

let opened = false;
let escaped = false;
let end = { state: null, shown: false, stats: '' };

if (placed.ok) {
  await wait(1500);
  await page.screenshot({ path: `${out}/escape_1_dormant.png` });

  await page.keyboard.press('KeyE');           // feed the fuses
  opened = await page.waitForFunction(() => window.__game.portals.portal?.isOpen === true,
    { timeout: 30000, polling: 200 }).then(() => true, () => false);
  await page.screenshot({ path: `${out}/escape_2_open.png` });

  if (opened) {
    await page.keyboard.press('KeyE');         // step through

    const marks = [0.15, 0.35, 0.55, 0.75, 0.92];
    // The game deliberately caps simulation dt. Under SwiftShader a frame can
    // take more than a second, turning a 17-second fall into five minutes and
    // making CI measure runner speed rather than the sequence. Advance the
    // real Escape object in small deterministic steps, rendering every mark.
    for (const mark of marks) {
      await page.evaluate((target) => {
        const g = window.__game;
        while (g.state === 'escaping' && g.escape.progress < target) g.escape.update(0.1);
      }, mark);
      await wait(100);
      await page.screenshot({ path: `${out}/escape_fall_${mark}.png` });
    }

    await page.evaluate(() => {
      const g = window.__game;
      while (g.state === 'escaping' && !g.escape.finished) g.escape.update(0.1);
    });
    escaped = await page.waitForFunction(
      () => window.__game?.state === 'escaped',
      { timeout: 30000, polling: 100 },
    ).then(() => true, () => false);

    await wait(1000);
    await page.screenshot({ path: `${out}/escape_3_screen.png` });
    end = await page.evaluate(() => ({
      state: window.__game?.state ?? null,
      shown: !document.getElementById('escape-screen').classList.contains('hidden'),
      stats: document.getElementById('escape-record').textContent.replace(/\s+/g, ' ').trim(),
    }));
    escaped ||= end.state === 'escaped';
    console.log('end:', JSON.stringify(end));
  }
}

report('escape', {
  reachedTheLastFloor: placed.onLastFloor,
  reachedThePortal: placed.ok,
  carriedThreeFuses: placed.fuses === 3,
  portalIsSomewhere: Array.isArray(placed.centre),
  threeFusesOpenTheDoor: opened,
  theFallEnds: escaped && end.state === 'escaped',
  escapeScreenShown: end.shown,
  escapeScreenSaysWhatYouDid: /\S/.test(end.stats),
}, errors);

await browser.close();
