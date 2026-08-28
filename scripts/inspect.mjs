// Headless internals probe: enemies, water meshes, pickups, taps, basins.
//
// This one is a probe rather than a gate — it deliberately sits through the
// encounter director's 45 s first-spawn grace, which is too long to put in
// front of every push. It still fails on a page error, so running it by hand
// after touching the spawner or the water tells you something.
//
// Usage: node scripts/inspect.mjs [url]        GRACE=0 skips the long wait

import { gameUrl, launch, report, wait, watch, waitForGame } from './lib/check.mjs';

const url = gameUrl();
const grace = Number(process.env.GRACE ?? 48000);

const browser = await launch();
const page = await browser.newPage();
const errors = watch(page);

await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-start');
await waitForGame(page);
await page.waitForFunction(() => window.__game.state === 'playing',
  { timeout: 30000, polling: 200 });
await wait(2500);

const probe = () => page.evaluate(() => {
  const g = window.__game;
  let waterMeshes = 0;
  let meshes = 0;
  g.scene.traverse((o) => {
    if (o.isMesh) meshes++;
    if (o.material && o.material.uniforms && o.material.uniforms.uTime) waterMeshes++;
  });
  let taps = 0, basins = 0, lights = 0, spawns = 0;
  for (const c of g.world.allChunks()) {
    taps += c.taps.length;
    lights += c.lights.length;
    spawns += c.itemSpawns.length;
    for (let k = 0; k < c.water.length; k++) if (c.water[k]) { basins++; break; }
  }
  return {
    pos: g.player.position.toArray().map((v) => +v.toFixed(1)),
    health: g.stats.health.toFixed(0),
    enemies: g.spawner.enemies.map((e) => `${e.typeName}:${e.state}`),
    meshes, waterMeshes, taps, lights, spawns, basins,
  };
});

const lobby = await probe();
console.log('T+3s  ', JSON.stringify(lobby));

// wait past the encounter director's first-spawn grace (45 s)
if (grace > 0) {
  await wait(grace);
  console.log('T+51s ', JSON.stringify(await probe()));
}

// check the poolrooms' water
await page.evaluate(() => window.__game.teleportToDepth(2));
await wait(3000);
const pool = await probe();
console.log('L37   ', JSON.stringify(pool));

report('inspect', {
  lobbyIsFurnished: lobby.meshes > 50 && lobby.lights > 0,
  lobbyHasSomethingToScavenge: lobby.spawns > 0,
  poolroomsHoldWater: pool.waterMeshes > 0 && pool.basins > 0,
}, errors);

await browser.close();
