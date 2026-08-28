// Headless descent: drops onto every floor in turn, finds each one's way down,
// and photographs both. Six levels is most of the game's surface area, and a
// floor that fails to build is invisible until somebody actually stands on it.
//
// Usage: node scripts/tour.mjs [url]

import { gameUrl, launch, report, wait, watch, waitForGame } from './lib/check.mjs';

const url = gameUrl();
const shots = process.env.SHOT_DIR ?? '/tmp';

const browser = await launch();
const page = await browser.newPage();
const errors = watch(page);

await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-start');
await waitForGame(page);
await page.waitForFunction(() => window.__game.state === 'playing',
  { timeout: 30000, polling: 200 });
await wait(2500);
await page.screenshot({ path: `${shots}/tour_0_lobby.png` });

const floors = ['parking', 'poolrooms', 'water', 'pipes', 'run'];
const landed = [];
for (let depth = 1; depth <= 5; depth++) {
  const arrived = await page.evaluate((d) => {
    const g = window.__game;
    const ok = g.teleportToDepth(d);
    const where = g.currentDepth();
    return { ok, depth: where.depth, name: where.name };
  }, depth);
  await wait(2500);
  await page.screenshot({ path: `${shots}/tour_${depth}_${floors[depth - 1]}.png` });
  landed.push(arrived);
  console.log(`${floors[depth - 1]}: teleport=${arrived.ok} now=${arrived.name}`);
}

// The way down on each floor, so its props get built at least once.
const descents = [];
for (let depth = 0; depth <= 4; depth++) {
  await page.evaluate((d) => window.__game.teleportToDepth(d), depth);
  await wait(1500);
  const ok = await page.evaluate(() => window.__game.teleportToDescent());
  await wait(2000);
  await page.screenshot({ path: `${shots}/tour_descent_${depth}.png` });
  descents.push(ok);
  console.log(`descent ${depth}: ${ok}`);
}

// Sink into Level 7 — crouch swims down, and the lungs only show up down there.
await page.evaluate(() => window.__game.teleportToDepth(3));
await wait(2500);
await page.keyboard.down('KeyC');
const wentUnder = await page.waitForFunction(
  () => window.__game.stats.oxygen < 99,
  { timeout: 60000, polling: 250 },
).then(() => true, () => false);
await page.screenshot({ path: `${shots}/tour_underwater.png` });
await page.keyboard.up('KeyC');

const hud = await page.evaluate(() => ({
  thirst: document.getElementById('thirst-fill').style.width,
  oxygen: document.getElementById('oxygen-fill').style.width,
  oxygenShown: !document.getElementById('oxygen-row').classList.contains('hidden'),
  biome: document.getElementById('biome-label').textContent.trim(),
  objective: document.getElementById('objective-title').textContent.trim(),
  alive: window.__game.stats.alive,
}));
console.log('HUD:', JSON.stringify(hud));

report('tour', {
  everyFloorAccepts: landed.every((l) => l.ok),
  everyFloorIsTheOneAskedFor: landed.every((l, i) => l.depth === i + 1),
  everyFloorIsNamed: landed.every((l) => /\S/.test(l.name)),
  everyFloorHasAWayDown: descents.every(Boolean),
  divingSpendsBreath: wentUnder,
  lungsShownUnderwater: hud.oxygenShown,
  survivedTheTour: hud.alive,
  hudStillDrawing: /%$/.test(hud.thirst) && /%$/.test(hud.oxygen)
    && /\S/.test(hud.biome) && /\S/.test(hud.objective),
}, errors);

await browser.close();
