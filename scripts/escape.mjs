// Headless run of a full extraction: jumps to the exit portal, feeds it three
// fuses, steps through and shoots the fall at fixed points of the sequence.
// Usage: node scripts/escape.mjs [seed] [url]

import puppeteer from 'puppeteer';

const seed = process.argv[2] ?? '1234';
const url = process.argv[3] ?? 'http://localhost:5199';
const out = '/tmp';

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
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${url}/?seed=${seed}`, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-start');
await wait(3500);

const placed = await page.evaluate(() => {
  const g = window.__game;
  const ok = g.teleportToExit(3);
  const p = g.portals.portal;
  return { ok, onWall: p?.spot.onWall, centre: p && [p.center.x, p.center.y, p.center.z] };
});
console.log('portal:', JSON.stringify(placed));
if (!placed.ok) {
  console.log('could not reach the portal');
  await browser.close();
  process.exit(1);
}

await wait(1200);
await page.screenshot({ path: `${out}/escape_1_dormant.png` });
await page.keyboard.press('KeyE');           // feed the fuses
await wait(2000);
await page.screenshot({ path: `${out}/escape_2_open.png` });
await page.keyboard.press('KeyE');           // step through

const marks = [0.15, 0.35, 0.55, 0.75, 0.92];
const shot = new Set();
for (let i = 0; i < 250; i++) {
  await wait(600);
  // a hot reload mid-run wipes __game; bail out instead of throwing
  const s = await page.evaluate(() => (window.__game
    ? { state: window.__game.state, progress: window.__game.escape.progress }
    : { state: 'reloaded', progress: 0 }));
  if (s.state === 'reloaded') {
    console.log('page reloaded mid-run (dev server?) — aborting');
    break;
  }
  for (const m of marks) {
    if (!shot.has(m) && s.progress >= m) {
      shot.add(m);
      await page.screenshot({ path: `${out}/escape_fall_${m}.png` });
    }
  }
  if (s.state === 'escaped') break;
}
await wait(800);
await page.screenshot({ path: `${out}/escape_3_screen.png` });

const end = await page.evaluate(() => ({
  state: window.__game.state,
  shown: !document.getElementById('escape-screen').classList.contains('hidden'),
  stats: document.getElementById('escape-record').textContent.replace(/\s+/g, ' ').trim(),
}));
console.log('end:', JSON.stringify(end));
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no console errors');
console.log(`screenshots in ${out}/escape_*.png`);

await browser.close();
