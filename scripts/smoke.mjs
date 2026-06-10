// Headless smoke test: boots the game, clicks DESCEND, walks around,
// opens the inventory, and reports console errors.
// Usage: node scripts/smoke.mjs [url]

import puppeteer from 'puppeteer';

const url = process.argv[2] ?? 'http://localhost:5199/?seed=1234';

const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--no-sandbox',
    '--window-size=1280,800',
  ],
  defaultViewport: { width: 1280, height: 800 },
});

const page = await browser.newPage();
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise((r) => setTimeout(r, 1000));
await page.screenshot({ path: '/tmp/shot_menu.png' });

// start the game
await page.click('#btn-start');
await new Promise((r) => setTimeout(r, 4000)); // preload + first frames
await page.screenshot({ path: '/tmp/shot_game.png' });

// walk forward + look around
await page.keyboard.down('KeyW');
await page.mouse.move(640, 400);
for (let i = 0; i < 10; i++) {
  await page.mouse.move(640 + i * 25, 400, { steps: 4 });
  await new Promise((r) => setTimeout(r, 150));
}
await page.keyboard.up('KeyW');
await page.screenshot({ path: '/tmp/shot_walk.png' });

// inventory overlay
await page.keyboard.press('Tab');
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: '/tmp/shot_inventory.png' });
await page.keyboard.press('Tab');
await new Promise((r) => setTimeout(r, 300));

// run a while to catch streaming/AI errors
await page.keyboard.down('KeyW');
await new Promise((r) => setTimeout(r, 6000));
await page.keyboard.up('KeyW');
await page.screenshot({ path: '/tmp/shot_longwalk.png' });

const state = await page.evaluate(() => ({
  hudVisible: !document.getElementById('hud').classList.contains('hidden'),
  health: document.getElementById('health-fill').style.width,
  thirst: document.getElementById('thirst-fill').style.width,
  fps: document.getElementById('fps-counter').textContent,
  biome: document.getElementById('biome-label').textContent,
}));

console.log('STATE:', JSON.stringify(state));
if (errors.length) {
  console.log(`ERRORS (${errors.length}):`);
  for (const e of errors.slice(0, 15)) console.log('  ' + e);
  process.exitCode = 1;
} else {
  console.log('NO CONSOLE ERRORS');
}

await browser.close();
