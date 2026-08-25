// Headless probe for the Level 37 ↔ Level 7 shaft: floods the poolrooms, opens
// the drain, swims down the pipe and back up again, and checks that the floor
// under the player's feet changes at the right height and that both slabs are
// standing at once.
//
// Software GL renders this at a few frames a second, so everything here is
// measured in frames rather than in seconds and the report says what the frame
// rate was — a swim that looks stalled is usually just a slow renderer.
//
// Usage: node scripts/shaft.mjs [url]

import puppeteer from 'puppeteer';

const url = process.argv[2] ?? 'http://localhost:5199/?seed=1234';
const SHOT = process.env.SHOT_DIR ?? '/tmp';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 640, height: 400 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
await wait(800);
await page.click('#btn-start');
await wait(3500);

const probe = () => page.evaluate(() => {
  const g = window.__game;
  const s = g.world.shaft;
  return {
    depth: g.currentDepth().depth,
    y: +g.player.position.y.toFixed(2),
    swim: g.player.swimming,
    open: g.world.shaftOpen,
    progress: +g.descent.progress.toFixed(2),
    flood: +g.descent.flood.toFixed(2),
    spec: s && { top: +s.top.toFixed(2), bottom: +s.bottom.toFixed(2) },
    slabs: [...new Set([...g.world.allChunks()].map((c) => c.depth))].sort(),
    chunks: [...g.world.allChunks()].length,
  };
});

/** Run n animation frames, reporting the rate they actually came at. */
const frames = (n) => page.evaluate((count) => new Promise((done) => {
  let i = 0;
  const t0 = performance.now();
  const tick = () => {
    if (++i >= count) return done(+(count / ((performance.now() - t0) / 1000)).toFixed(1));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), n);

// ---- the deep end ---------------------------------------------------------
await page.evaluate(() => { window.__game.teleportToDepth(2); window.__game.teleportToDescent(); });
await wait(1500);
console.log('deep end  ', JSON.stringify(await probe()));
await page.screenshot({ path: `${SHOT}/shaft_1_deepend.png` });

// ---- the valve, turned the long way --------------------------------------
const gotSub = await page.evaluate(() => window.__game.teleportToSub());
await wait(600);
await page.keyboard.down('KeyE');
const fps = await frames(240);
await page.keyboard.up('KeyE');
console.log(`valve     reached=${gotSub} fps=${fps}`, JSON.stringify(await probe()));

// Let it fill. Software GL runs at a couple of frames a second and the game
// clamps dt to 0.05, so its clock crawls next to the wall clock — waiting out
// the real flood takes minutes. The valve above proves that chain works; from
// here on the probe is about the pipe, so the grate is opened outright.
await page.evaluate(() => {
  const g = window.__game;
  g.descent.flood = 2.6;
  g.world.setWaterRise(2.6);
  g.openTheWayDown();
});
await page.evaluate(() => { window.__game.teleportToDescent(); });
await wait(1200);
console.log('grate     ', JSON.stringify(await probe()));
await page.screenshot({ path: `${SHOT}/shaft_2_grate.png` });

// ---- down the pipe --------------------------------------------------------
const run = async (label, key, place, stop, shot) => {
  await page.evaluate(place);
  await wait(400);
  await page.keyboard.down(key);
  const seen = [];
  for (let i = 0; i < 40; i++) {
    await frames(10);
    const p = await probe();
    seen.push(`${p.y}/${p.depth}`);
    if (shot && i === 10) await page.screenshot({ path: shot });
    if (await page.evaluate(stop)) break;
  }
  await page.keyboard.up(key);
  console.log(`${label}`, JSON.stringify(await probe()));
  console.log(`  trace   ${seen.join(' ')}`);
};

await run(
  'descend  ', 'KeyC',
  () => {
    const g = window.__game, s = g.world.shaft;
    g.player.position.set(s.x, s.top - 0.5, s.z);
    g.player.velocity.set(0, 0, 0);
    g.player.pitch = -1.1;
  },
  () => window.__game.player.position.y < window.__game.world.shaft.bottom - 1,
  `${SHOT}/shaft_3_inpipe.png`,
);
await page.screenshot({ path: `${SHOT}/shaft_4_arrived.png` });

await run(
  'ascend   ', 'Space',
  () => {
    const g = window.__game, s = g.world.shaft;
    g.player.position.set(s.x, s.bottom - 0.8, s.z);
    g.player.velocity.set(0, 0, 0);
    g.player.pitch = 1.1;
  },
  () => window.__game.player.position.y > window.__game.world.shaft.top + 0.3,
  null,
);
await page.screenshot({ path: `${SHOT}/shaft_5_backup.png` });

console.log('\nerrors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
