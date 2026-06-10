// Headless biome tour: teleports across all four levels and screenshots each.
// Usage: node scripts/tour.mjs

import puppeteer from 'puppeteer';

const url = 'http://localhost:5199/?seed=1234';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1280, height: 800 },
});

const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(url, { waitUntil: 'networkidle0' });
await page.click('#btn-start');
await new Promise((r) => setTimeout(r, 3500));
await page.screenshot({ path: '/tmp/tour_level0.png' });

for (const [id, name] of [[1, 'level2'], [2, 'level37'], [3, 'level7']]) {
  const ok = await page.evaluate((biome) => window.__game.teleportToBiome(biome), id);
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `/tmp/tour_${name}.png` });
  console.log(`${name}: teleport=${ok}`);
}

// dive into the Level 7 water (crouch to sink, look slightly down)
await page.keyboard.down('KeyC');
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: '/tmp/tour_underwater.png' });
await page.keyboard.up('KeyC');

const hud = await page.evaluate(() => ({
  thirst: document.getElementById('thirst-fill').style.width,
  biome: document.getElementById('biome-label').textContent,
  fps: document.getElementById('fps-counter').textContent,
}));
console.log('HUD:', JSON.stringify(hud));
console.log(errors.length ? `ERRORS: ${errors.slice(0, 8).join(' | ')}` : 'NO CONSOLE ERRORS');
await browser.close();
