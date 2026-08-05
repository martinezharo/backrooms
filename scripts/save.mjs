// Checkpoint test: builds up a run, quits, comes back through CONTINUE and
// checks the maze picked up exactly where it was left — then checks the save
// does not survive the two endings.
// Usage: node scripts/save.mjs [url]

import puppeteer from 'puppeteer';

const url = process.argv[2] ?? 'http://localhost:5199/?seed=1234';
const KEY = 'backrooms.save.v1';

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

const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function openTab() {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait(1500);
  return page;
}

const snapshot = (page) => page.evaluate(() => {
  const g = window.__game;
  return {
    state: g.state,
    pos: [g.player.position.x, g.player.position.y, g.player.position.z].map((n) => +n.toFixed(2)),
    yaw: +g.player.yaw.toFixed(3),
    health: +g.stats.health.toFixed(1),
    thirst: +g.stats.thirst.toFixed(1),
    items: g.inventory.items.map((p) => p.item.def.id).sort(),
    equipped: g.inventory.equipped?.def.id ?? null,
    torch: +g.torchCharge.toFixed(1),
    torchOn: g.lighting.flashlightOn,
    survival: +g.survivalTime.toFixed(1),
    consumed: [...g.pickups.consumed].sort(),
    drops: g.pickups.pickups.filter((p) => p.spawnId === null).map((p) => p.item.def.id).sort(),
    friends: g.spawner.enemies.filter((e) => e.befriended).map((e) => e.voiceId).sort(),
    portalOpened: g.portalOpened,
    portalIsOpen: g.portals.portal?.isOpen ?? false,
    escapeFuses: g.escapeFuses,
    vending: [...g.vendingLeft].sort(),
    receiverOnExit: g.receiverOnExit,
  };
});

// ---------------------------------------------------------------- round trip

let page = await openTab();
await page.evaluate((k) => localStorage.removeItem(k), KEY);
await page.reload({ waitUntil: 'domcontentloaded' });
await wait(1000);

const cleanSlate = await page.evaluate(() =>
  document.getElementById('btn-continue').classList.contains('hidden'));
console.log('continue hidden on a clean slate:', cleanSlate);

await page.click('#btn-start');
await wait(5000);

// A run worth resuming: a fuse off its plinth, an item left on the floor,
// a hugged monster, a drained torch and the door already fed.
console.log('setup:', await page.evaluate(() => {
  const g = window.__game;
  g.teleportToFuse(0);
  const fuse = g.pickups.nearest(g.player.position, 8);
  if (!fuse) throw new Error('no fuse near the plinth');
  g.inventory.add(g.pickups.take(fuse));
  g.dropItem(g.inventory.has('detector'));

  g.stats.thirst = 61.5;
  g.stats.health = 88;
  g.torchCharge = 73.5;
  g.lighting.setFlashlight(true);
  g.receiverOnExit = true;
  g.vendingLeft.set('test-machine', 1);

  g.spawner.trySpawn(g.player.position);
  const mob = g.spawner.enemies[0];
  if (mob) mob.befriend();

  const atExit = g.teleportToExit(2);
  if (atExit) g.openPortal(g.inventory.items.filter((p) => p.item.def.id === 'fuse').length);
  return { atExit, hugged: !!mob };
}));
await wait(1500);

// Pausing writes the checkpoint at once — but headless throttles rAF hard, so
// wait for the frame that actually consumes the key instead of guessing.
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.__game.state === 'paused',
  { timeout: 20000, polling: 200 });
const before = await snapshot(page);
const bytes = await page.evaluate((k) => {
  const raw = localStorage.getItem(k);
  return raw === null ? 0 : raw.length;
}, KEY);
console.log('before:', JSON.stringify(before));
console.log('save bytes:', bytes);

// A fresh tab rather than a reload: tearing down a live WebGL context can hang
// the navigation, and this lands on the same origin anyway.
await page.close();
page = await openTab();
const label = await page.evaluate(() => {
  const b = document.getElementById('btn-continue');
  return b.classList.contains('hidden') ? null : b.textContent;
});
console.log('continue offered:', label);
console.log('start button relabelled:', await page.evaluate(() =>
  document.getElementById('btn-start').textContent));

await page.click('#btn-continue');
await wait(6000);
const after = await snapshot(page);
console.log('after: ', JSON.stringify(after));

// the dropped item is parked until its chunk streams back in: go and look
const plinth = await page.evaluate(async () => {
  const g = window.__game;
  const parked = [...g.pickups.droppedByChunk.values()].flat().map((d) => d.item.def.id);
  g.teleportToFuse(0);
  await new Promise((r) => setTimeout(r, 1500));
  return {
    parked,
    onTheFloor: g.pickups.pickups.filter((p) => p.spawnId === null).map((p) => p.item.def.id),
    fuseRespawned: g.pickups.pickups.some((p) => p.item.def.id === 'fuse'),
  };
});
console.log('back at the plinth:', JSON.stringify(plinth));
await page.evaluate((k) => localStorage.removeItem(k), KEY);
await page.close();

// ------------------------------------------------------------ save and quit

page = await openTab();
await page.evaluate((k) => localStorage.removeItem(k), KEY);
await page.click('#btn-start');
await wait(5000);
await page.evaluate(() => { window.__game.torchCharge = 42; });
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.__game.state === 'paused',
  { timeout: 20000, polling: 200 });
const pauseNote = await page.evaluate(() =>
  document.getElementById('pause-saved').textContent);
console.log('pause reassurance:', JSON.stringify(pauseNote));
await page.screenshot({ path: '/tmp/save_pause.png' });

await page.click('#btn-save-quit');
// the landing page has to come back with the run on offer, not just come back
const quitLanded = await page.waitForFunction(() => {
  if (window.__game) return false; // still the old document
  const landing = !document.getElementById('start-screen').classList.contains('hidden');
  const offered = !document.getElementById('btn-continue').classList.contains('hidden');
  return landing && offered ? { onLanding: landing, continueOffered: offered } : false;
}, { timeout: 20000, polling: 200 }).then((h) => h.jsonValue()).catch(() => ({
  onLanding: false, continueOffered: false,
}));
console.log('after save & quit:', JSON.stringify(quitLanded));
await page.screenshot({ path: '/tmp/save_landing.png' });

await page.click('#btn-continue');
await wait(6000);
const torchAfterQuit = await page.evaluate(() => +window.__game.torchCharge.toFixed(0));
console.log('torch charge carried through quit:', torchAfterQuit);
await page.evaluate((k) => localStorage.removeItem(k), KEY);
await page.close();

// ------------------------------------------------------------- both endings

async function ending(kind) {
  const p = await openTab();
  await p.click('#btn-start');
  await wait(5000);
  const had = await p.evaluate((k) => {
    window.__game.saveRun();
    return !!localStorage.getItem(k);
  }, KEY);
  const out = await p.evaluate((args) => {
    const g = window.__game;
    if (args.kind === 'death') g.stats.applyDamage(999, 'dehydration');
    else { g.teleportToExit(3); g.openPortal(3); g.beginEscape(); }
    return { state: g.state, save: localStorage.getItem(args.key) };
  }, { kind, key: KEY });
  await p.evaluate((k) => localStorage.removeItem(k), KEY);
  await p.close();
  console.log(`${kind}: saved first: ${had} · state: ${out.state} · cleared: ${out.save === null}`);
  return had && out.save === null;
}

const clearedOnDeath = await ending('death');
const clearedOnEscape = await ending('escape');

// ------------------------------------------------------------------ verdict

const same = (k) => JSON.stringify(before[k]) === JSON.stringify(after[k]);
const near = (k, tol) => Math.abs(after[k] - before[k]) <= tol;
const checks = {
  cleanSlateHidesContinue: cleanSlate,
  continueOffered: !!label,
  // x/z exact; y settles onto the floor by a centimetre as the run resumes
  position: after.pos[0] === before.pos[0] && after.pos[2] === before.pos[2]
    && Math.abs(after.pos[1] - before.pos[1]) < 0.2,
  yaw: same('yaw'),
  inventory: same('items'),
  equipped: same('equipped'),
  consumedSpawns: same('consumed') && before.consumed.length > 0,
  droppedItemKept: plinth.parked.includes('detector') && plinth.onTheFloor.includes('detector'),
  takenFuseNeverComesBack: !plinth.fuseRespawned,
  friendsKept: same('friends') && before.friends.length > 0,
  doorStillOpen: after.portalOpened && after.portalIsOpen && same('escapeFuses'),
  vendingServings: same('vending'),
  receiverMode: same('receiverOnExit'),
  torchStillOn: after.torchOn === before.torchOn,
  // these keep ticking between the checkpoint and each snapshot
  healthWithinDrift: near('health', 2),
  thirstWithinDrift: near('thirst', 2),
  torchWithinDrift: near('torch', 2),
  survivalWithinDrift: near('survival', 6),
  pauseSaysItIsSaved: /run saved/.test(pauseNote),
  quitReturnsToLanding: quitLanded.onLanding && quitLanded.continueOffered,
  quitKeptTheRun: torchAfterQuit === 42,
  clearedOnDeath,
  clearedOnEscape,
};
console.log('checks:', JSON.stringify(checks, null, 2));
console.log('errors:', errors.length ? errors : 'none');

const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
console.log(failed.length ? `FAILED: ${failed.join(', ')}` : 'ALL PASS');

await browser.close();
process.exit(failed.length ? 1 : 0);
