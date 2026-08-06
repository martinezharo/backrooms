// Headless descent: drops onto every floor in turn and screenshots it, plus
// the two places the camera goes underwater.
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
await page.screenshot({ path: '/tmp/tour_0_lobby.png' });

const floors = ['parking', 'poolrooms', 'water', 'pipes', 'run'];
for (let depth = 1; depth <= 5; depth++) {
  const ok = await page.evaluate((d) => window.__game.teleportToDepth(d), depth);
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `/tmp/tour_${depth}_${floors[depth - 1]}.png` });
  const where = await page.evaluate(() => window.__game.currentDepth());
  console.log(`${floors[depth - 1]}: teleport=${ok} now=${where.name}`);
}

// the way down on each floor, so the props get looked at at least once
for (let depth = 0; depth <= 4; depth++) {
  await page.evaluate((d) => window.__game.teleportToDepth(d), depth);
  await new Promise((r) => setTimeout(r, 1200));
  const ok = await page.evaluate(() => window.__game.teleportToDescent());
  await new Promise((r) => setTimeout(r, 1800));
  await page.screenshot({ path: `/tmp/tour_descent_${depth}.png` });
  console.log(`descent ${depth}: ${ok}`);
}

// sink into Level 7 (crouch swims down)
await page.evaluate(() => window.__game.teleportToDepth(3));
await new Promise((r) => setTimeout(r, 2000));
await page.keyboard.down('KeyC');
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: '/tmp/tour_underwater.png' });
await page.keyboard.up('KeyC');

const hud = await page.evaluate(() => ({
  thirst: document.getElementById('thirst-fill').style.width,
  oxygen: document.getElementById('oxygen-fill').style.width,
  oxygenShown: !document.getElementById('oxygen-row').classList.contains('hidden'),
  biome: document.getElementById('biome-label').textContent,
  objective: document.getElementById('objective-title').textContent,
  fps: document.getElementById('fps-counter').textContent,
}));
console.log('HUD:', JSON.stringify(hud));
console.log(errors.length ? `ERRORS: ${errors.slice(0, 8).join(' | ')}` : 'NO CONSOLE ERRORS');
await browser.close();
