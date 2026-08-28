// Headless check: hunt down a graffiti tag on a Level 0 wall and photograph it.
// The tags are the only writing in the world and they are placed by the same
// per-chunk generator as everything else, so an empty sweep means chunk
// decoration has stopped happening at all.
//
// Usage: node scripts/graffiti.mjs [url]

import { gameUrl, launch, report, wait, watch, waitForGame } from './lib/check.mjs';

const url = gameUrl();
const shot = process.env.SHOT ?? `${process.env.SHOT_DIR ?? '/tmp'}/graffiti.png`;

const browser = await launch();
const page = await browser.newPage();
const errors = watch(page);

await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-start');
await waitForGame(page);
await page.waitForFunction(() => window.__game.state === 'playing',
  { timeout: 30000, polling: 200 });
await wait(2500);

const found = await page.evaluate(() => {
  const g = window.__game;
  const CHUNK = 32;
  let scanned = 0, tagged = 0, tags = 0, first = null;
  for (let r = 0; r < 7 && !first; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        g.world.preload(dx * CHUNK + 16, dz * CHUNK + 16);
        for (const c of g.world.allChunks()) {
          if (c.cx !== dx || c.cz !== dz) continue;
          scanned++;
          if (c.graffiti.length) {
            tagged++;
            tags += c.graffiti.length;
            first ??= c.graffiti[0];
          }
        }
      }
    }
  }
  if (first) {
    const nx = Math.sin(first.angle);
    const nz = Math.cos(first.angle);
    g.world.preload(first.x, first.z);
    g.player.position.set(first.x + nx * 1.3, 0.05, first.z + nz * 1.3);
    g.player.yaw = first.angle;
    g.player.pitch = -0.08;
  }
  return { scanned, tagged, tags, first };
});

console.log(JSON.stringify(found));
await wait(2000);
await page.screenshot({ path: shot });

report('graffiti', {
  chunksBuilt: found.scanned > 10,
  wallsGotTagged: found.tagged > 0,
  tagHasAPlaceOnAWall: !!found.first
    && Number.isFinite(found.first.x)
    && Number.isFinite(found.first.z)
    && Number.isFinite(found.first.angle),
}, errors);

await browser.close();
