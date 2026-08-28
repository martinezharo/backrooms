// Headless smoke test: boots the game, walks through the door, moves, looks
// around, opens the bag, and keeps running long enough for chunk streaming and
// the encounter director to have something to say.
//
// This is the check that answers "does the game still start and play at all",
// so it asserts on the run rather than only counting console errors.
//
// Usage: node scripts/smoke.mjs [url]

import { gameUrl, launch, report, wait, watch, waitForGame } from './lib/check.mjs';

const url = gameUrl();
const shots = process.env.SHOT_DIR ?? '/tmp';

const browser = await launch();
const page = await browser.newPage();
const errors = watch(page);

await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForSelector('#btn-start', { timeout: 15000 });
await page.screenshot({ path: `${shots}/shot_menu.png` });

const landing = await page.evaluate(() => ({
  // The landing page is the whole product until someone presses a door.
  visible: !document.getElementById('start-screen').classList.contains('hidden'),
  hudHidden: document.getElementById('hud').classList.contains('hidden'),
  label: document.querySelector('#btn-start .door-label').textContent.trim(),
}));

await page.click('#btn-start');
await waitForGame(page);
await page.waitForFunction(() => window.__game.state === 'playing',
  { timeout: 30000, polling: 200 });
await wait(2500); // preload + first frames
await page.screenshot({ path: `${shots}/shot_game.png` });

const started = await page.evaluate(() => {
  const g = window.__game;
  return {
    state: g.state,
    depth: g.currentDepth(),
    pos: [g.player.position.x, g.player.position.z],
    yaw: g.player.yaw,
    hudVisible: !document.getElementById('hud').classList.contains('hidden'),
    landingGone: document.getElementById('start-screen').classList.contains('hidden'),
  };
});

// Walk forward, and turn the camera the way the touch pad does. Real mouse
// look needs Pointer Lock, which headless Chrome never grants, so driving the
// look delta straight into Input is the only way to check the camera at all.
await page.evaluate(() => {
  const p = window.__game.player;
  window.__from = [p.position.x, p.position.z];
});
await page.keyboard.down('KeyW');
// Wait for the metres, not for a stopwatch: SwiftShader runs the simulation at
// a few frames a second, so "walk for three seconds" covers a different
// distance on every machine and fails on the slowest one.
const walked = await page.waitForFunction(() => {
  const p = window.__game.player;
  return Math.hypot(p.position.x - window.__from[0], p.position.z - window.__from[1]) > 2;
}, { timeout: 60000, polling: 200 }).then(() => true, () => false);
await page.evaluate(() => { for (let i = 0; i < 10; i++) window.__game.input.addLook(60, 0); });
await wait(1000);
await page.keyboard.up('KeyW');
await page.screenshot({ path: `${shots}/shot_walk.png` });

const moved = await page.evaluate(() => {
  const g = window.__game;
  return { pos: [g.player.position.x, g.player.position.z], yaw: g.player.yaw };
});

// The inventory overlay. Software rendering drags the frame rate into single
// digits, so every one of these waits on the state rather than on a clock —
// a fixed delay here is a test that fails on a busy CI runner and nowhere else.
const bagIs = (open) => page.waitForFunction(
  (want) => document.getElementById('inventory-screen').classList.contains('hidden') !== want,
  { timeout: 20000, polling: 200 }, open,
).then(() => true, () => false);

await page.keyboard.press('Tab');
const bagOpen = await bagIs(true);
await page.screenshot({ path: `${shots}/shot_inventory.png` });
await page.keyboard.press('Tab');
const bagClosed = await bagIs(false);

// Keep going until the player has crossed into new chunks, so streaming, the
// encounter director and the props all get a chance to throw.
await page.keyboard.down('KeyW');
await page.waitForFunction(() => {
  const p = window.__game.player;
  return Math.hypot(p.position.x - window.__from[0], p.position.z - window.__from[1]) > 20;
}, { timeout: 90000, polling: 250 }).catch(() => undefined);
await page.keyboard.up('KeyW');
await page.screenshot({ path: `${shots}/shot_longwalk.png` });

const end = await page.evaluate(() => {
  const g = window.__game;
  let meshes = 0;
  g.scene.traverse((o) => { if (o.isMesh) meshes++; });
  return {
    state: g.state,
    alive: g.stats.alive,
    chunks: [...g.world.allChunks()].length,
    meshes,
    health: document.getElementById('health-fill').style.width,
    thirst: document.getElementById('thirst-fill').style.width,
    fps: Number(document.getElementById('fps-counter').textContent.replace(/\D/g, '')),
    biome: document.getElementById('biome-label').textContent.trim(),
  };
});

console.log('STATE:', JSON.stringify(end));

report('smoke', {
  landingPageShown: landing.visible && landing.hudHidden,
  startDoorLabelled: /\S/.test(landing.label),
  gameStarted: started.state === 'playing',
  landingPageDismissed: started.landingGone,
  hudShown: started.hudVisible,
  startsOnTheLobby: started.depth.depth === 0,
  walkingMovesThePlayer: walked,
  lookTurnsTheCamera: Math.abs(moved.yaw - started.yaw) > 0.05,
  bagOpens: bagOpen,
  bagCloses: bagClosed,
  worldStreamedIn: end.chunks > 1 && end.meshes > 50,
  stillPlaying: end.state === 'playing' && end.alive,
  hudBarsDrawn: /%$/.test(end.health) && /%$/.test(end.thirst),
  levelNamed: /\S/.test(end.biome),
}, errors);

await browser.close();
