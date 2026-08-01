// Headless touch test: boots the game on a phone-sized viewport with the
// on-screen controls forced on, drives the stick, the look pad and the
// buttons, and checks the player actually reacted.
// Usage: node scripts/mobile.mjs [url]

import puppeteer from 'puppeteer';

const url = process.argv[2] ?? 'http://localhost:5199/?seed=1234&touch=1';
const W = 844;
const H = 390;

const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--no-sandbox',
    `--window-size=${W},${H}`,
  ],
  defaultViewport: { width: W, height: H, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
});

const page = await browser.newPage();
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const player = () => page.evaluate(() => {
  const p = window.__game.player;
  return { x: p.position.x, z: p.position.z, yaw: p.yaw, pitch: p.pitch };
});

await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
await wait(800);
await page.screenshot({ path: '/tmp/touch_menu.png' });

await page.click('#btn-start');
await wait(4000);
await page.screenshot({ path: '/tmp/touch_game.png' });

const controlsVisible = await page.evaluate(() =>
  !document.getElementById('touch-controls').classList.contains('hidden')
  && document.body.classList.contains('touch'));

// ---- stick: hold forward-left for a second ----
const before = await player();
const stick = await page.touchscreen.touchStart(150, 250);
await stick.move(110, 190);
await wait(1200);
await page.screenshot({ path: '/tmp/touch_stick.png' });
await stick.end();
const afterMove = await player();
const walked = Math.hypot(afterMove.x - before.x, afterMove.z - before.z);

// ---- look pad: drag across the right half ----
const look = await page.touchscreen.touchStart(600, 200);
for (let i = 1; i <= 8; i++) {
  await look.move(600 + i * 18, 200 + i * 4);
  await wait(40);
}
await look.end();
const afterLook = await player();
const turned = Math.abs(afterLook.yaw - afterMove.yaw);
const pitched = Math.abs(afterLook.pitch - afterMove.pitch);

// ---- buttons ----
const tap = async (id) => {
  const box = await page.$eval(id, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const t = await page.touchscreen.touchStart(box.x, box.y);
  await wait(120);
  await t.end();
  await wait(250);
};

await tap('#touch-btn-attack');
await tap('#touch-btn-jump');
await tap('#touch-btn-crouch');
const crouching = await page.evaluate(() => window.__game.player.crouching);
await tap('#touch-btn-crouch');
const stoodBackUp = await page.evaluate(() => !window.__game.player.crouching);

// ---- equip from the hotbar by tapping it (the touch stand-in for 1–9) ----
await tap('#touch-btn-use');
// stock the bag the way the escape test does, so this doesn't hunt for loot
await page.evaluate(() => window.__game.teleportToExit(1));
await wait(600);
const carried = await page.evaluate(() => window.__game.inventory.items.length);
let hotbarEquipped = null;
if (carried > 0) {
  await tap('#hotbar .hotbar-slot');
  hotbarEquipped = await page.evaluate(() => !!window.__game.inventory.equipped);
}

await tap('#touch-btn-bag');
await wait(500);
await page.screenshot({ path: '/tmp/touch_bag.png' });
const bagFits = await page.evaluate(() => {
  const r = document.getElementById('inventory-panel').getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight;
});
const bagState = await page.evaluate(() => ({
  open: !document.getElementById('inventory-screen').classList.contains('hidden'),
  trimmed: document.getElementById('touch-controls').classList.contains('bag-open'),
}));
await tap('#touch-btn-bag');
await wait(400);
const bagClosed = await page.evaluate(() =>
  document.getElementById('inventory-screen').classList.contains('hidden'));

// ---- pause ----
await tap('#touch-btn-pause');
await wait(500);
await page.screenshot({ path: '/tmp/touch_pause.png' });
const paused = await page.evaluate(() => ({
  menu: !document.getElementById('pause-screen').classList.contains('hidden'),
  controlsHidden: document.getElementById('touch-controls').classList.contains('hidden'),
}));

console.log('CONTROLS VISIBLE:', controlsVisible);
console.log('STICK walked:', walked.toFixed(2), 'm');
console.log('LOOK yaw:', turned.toFixed(3), 'rad · pitch:', pitched.toFixed(3), 'rad');
console.log('CROUCH toggle on/off:', crouching, stoodBackUp);
console.log('HOTBAR: carried', carried, '· tap equipped:', hotbarEquipped);
console.log('BAG:', JSON.stringify(bagState), 'closes again:', bagClosed, '· fits on screen:', bagFits);
console.log('PAUSE:', JSON.stringify(paused));

const failures = [];
if (!controlsVisible) failures.push('touch controls never appeared');
if (walked < 0.5) failures.push(`stick moved the player only ${walked.toFixed(2)} m`);
if (turned < 0.05) failures.push('look pad did not turn the camera');
if (pitched < 0.02) failures.push('look pad did not pitch the camera');
if (!crouching || !stoodBackUp) failures.push('crouch toggle did not latch both ways');
if (hotbarEquipped === false) failures.push('tapping a hotbar slot did not equip it');
if (!bagState.open || !bagState.trimmed || !bagClosed) failures.push('bag button misbehaved');
if (!bagFits) failures.push('the bag panel does not fit on a phone screen');
if (!paused.menu || !paused.controlsHidden) failures.push('pause button misbehaved');
if (errors.length) failures.push(`${errors.length} console errors`);

if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  ' + f);
  for (const e of errors.slice(0, 10)) console.log('  ' + e);
  process.exitCode = 1;
} else {
  console.log('TOUCH CONTROLS OK');
}

await browser.close();
