// Headless check: hunt down a graffiti tag on a Level 0 wall and photograph it.
// Usage: node scripts/graffiti.mjs [url]

import puppeteer from 'puppeteer';

const url = process.argv[2] ?? 'http://localhost:5199/?seed=1234';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url, { waitUntil: 'networkidle0' });
await page.click('#btn-start');
await new Promise((r) => setTimeout(r, 3000));

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
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: process.env.SHOT ?? '/tmp/claude-0/graffiti.png' });
console.log(errors.length ? `ERRORS: ${errors.join(' | ')}` : 'NO PAGE ERRORS');
await browser.close();
