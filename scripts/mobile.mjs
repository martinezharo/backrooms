// Headless touch test: boots the game on a phone-sized viewport with the
// on-screen controls forced on, drives the stick, the look pad and the
// buttons, and checks the player actually reacted.
// Usage: node scripts/mobile.mjs [url]

import { gameUrl, launch, watch, waitForGame } from './lib/check.mjs';

const url = gameUrl('http://localhost:5199', '?seed=1234&touch=1');
const shots = process.env.SHOT_DIR ?? '/tmp';
const W = 844;
const H = 390;

const browser = await launch({
  width: W, height: H, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
});

const page = await browser.newPage();
const errors = watch(page);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const player = () => page.evaluate(() => {
  const p = window.__game.player;
  return { x: p.position.x, z: p.position.z, yaw: p.yaw, pitch: p.pitch };
});

await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
await wait(800);
await page.screenshot({ path: `${shots}/touch_menu.png` });

await page.click('#btn-start');
// Software rendering can take tens of seconds to reach the first frame; wait
// for the run to be under way rather than for a stopwatch.
await waitForGame(page);
await page.waitForFunction(() => window.__game.state === 'playing',
  { timeout: 60000, polling: 200 });
await wait(2000);
await page.screenshot({ path: `${shots}/touch_game.png` });

const controlsVisible = await page.evaluate(() =>
  !document.getElementById('touch-controls').classList.contains('hidden')
  && document.body.classList.contains('touch'));

// ---- stick: hold forward-left for a second ----
const before = await player();
const stick = await page.touchscreen.touchStart(150, 250);
// a lean, not a shove: far enough to walk, short of the rim that sprints
await stick.move(128, 228);
await wait(1200);
await page.screenshot({ path: `${shots}/touch_stick.png` });
const joggedNotRun = await page.evaluate(() => window.__game.player.running);
// shoving the thumb out to the rim is the sprint — there is no RUN button
await stick.move(150, 120);
await wait(900);
const sprinted = await page.evaluate(() => window.__game.player.running);
await stick.end();
// software rendering runs this at a few frames a second; give the simulation
// time to see the released key before asking what the legs are doing
await wait(900);
const stoppedSprinting = await page.evaluate(() => !window.__game.player.running);
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

// ---- the rig only shows what you can actually use ----
const shown = (id) => page.evaluate(
  (sel) => {
    const el = document.querySelector(sel);
    return !!el && !el.classList.contains('gone') && el.offsetParent !== null;
  }, id);
const buttonsAtStart = {
  torch: await shown('#touch-btn-torch'),      // you start carrying one
  receiver: await shown('#touch-btn-receiver'), // one thing to point it at
  drop: await shown('#touch-btn-drop'),        // nothing in hand yet
  hug: await shown('#touch-btn-hug'),          // the egg has no button at all
};

// ---- nothing on screen may name a key this device does not have ----
const keyboardWords = /\b(TAB|ESC|SHIFT|LEFT CLICK|RIGHT CLICK|WHEEL|\[[A-Z]\]|^E —)\b/;
const hudText = await page.evaluate(() => [
  document.getElementById('interact-prompt')?.textContent ?? '',
  document.getElementById('equipped-label')?.textContent ?? '',
  document.getElementById('objective-title')?.textContent ?? '',
].join(' | '));

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
// the last floor is the only one with two things to aim the receiver at, so
// it is the only one where its button means anything
const receiverAtExit = await shown('#touch-btn-receiver');

// ---- the hug is an easter egg: no button, a long still press on the look pad ----
await page.evaluate(() => {
  window.__virtualKeys = [];
  const i = window.__game.input;
  const real = i.setVirtualKey.bind(i);
  i.setVirtualKey = (code, down) => { if (down) window.__virtualKeys.push(code); real(code, down); };
});
const still = await page.touchscreen.touchStart(620, 200);
await wait(900);
await still.end();
const longPressHugged = await page.evaluate(() => window.__virtualKeys.includes('KeyH'));
// …and a drag across the same pad is just looking around
await page.evaluate(() => { window.__virtualKeys.length = 0; });
const dragged = await page.touchscreen.touchStart(620, 200);
for (let i = 1; i <= 10; i++) { await dragged.move(620 + i * 14, 200); await wait(70); }
await dragged.end();
const dragStayedALook = await page.evaluate(() => !window.__virtualKeys.includes('KeyH'));
const carried = await page.evaluate(() => window.__game.inventory.items.length);
let hotbarEquipped = null;
if (carried > 0) {
  await tap('#hotbar .hotbar-slot');
  hotbarEquipped = await page.evaluate(() => !!window.__game.inventory.equipped);
}

await tap('#touch-btn-bag');
await wait(500);
await page.screenshot({ path: `${shots}/touch_bag.png` });
// a finger cannot drag an item onto the floor: the tapped tile grows a button
let droppedFromBag = null;
if (carried > 0) {
  await tap('.inv-item');
  const actionsUp = await page.evaluate(() =>
    !document.getElementById('inventory-actions').classList.contains('hidden'));
  await page.screenshot({ path: `${shots}/touch_bag_item.png` });
  await tap('#inventory-action-drop');
  await wait(400);
  const left = await page.evaluate(() => window.__game.inventory.items.length);
  droppedFromBag = actionsUp && left === carried - 1;
}
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
await page.screenshot({ path: `${shots}/touch_pause.png` });
const paused = await page.evaluate(() => ({
  menu: !document.getElementById('pause-screen').classList.contains('hidden'),
  controlsHidden: document.getElementById('touch-controls').classList.contains('hidden'),
}));

console.log('CONTROLS VISIBLE:', controlsVisible);
console.log('STICK walked:', walked.toFixed(2), 'm');
console.log('SPRINT at the rim:', sprinted, '· jogging first:', joggedNotRun, '· released:', stoppedSprinting);
console.log('CONTEXT BUTTONS:', JSON.stringify(buttonsAtStart), '· receiver on the last floor:', receiverAtExit);
console.log('HUG: long press', longPressHugged, '· a drag is still just a look:', dragStayedALook);
console.log('HUD TEXT:', hudText);
console.log('BAG DROP:', droppedFromBag);
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
if (!sprinted || !stoppedSprinting) failures.push('pushing the stick to the rim did not sprint');
if (joggedNotRun) failures.push('a half-tilted stick already counted as a sprint');
if (!buttonsAtStart.torch) failures.push('a carried tool has no button');
if (buttonsAtStart.drop || buttonsAtStart.receiver) failures.push('a button is on screen with nothing to use it on');
if (buttonsAtStart.hug) failures.push('the hug easter egg has a button advertising it');
if (!receiverAtExit) failures.push('the receiver cannot be re-aimed on the floor that has two targets');
if (!longPressHugged) failures.push('a long still press on the look pad did not reach for a hug');
if (!dragStayedALook) failures.push('looking around triggered the hug gesture');
if (keyboardWords.test(hudText)) failures.push(`the HUD names a key a phone has not got: ${hudText}`);
if (droppedFromBag === false) failures.push('dropping an item from the bag by touch failed');
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
