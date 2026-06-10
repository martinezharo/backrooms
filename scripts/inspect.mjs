// Headless internals probe: enemies, water meshes, pickups, taps, basins.

import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5199/?seed=1234', { waitUntil: 'networkidle0' });
await page.click('#btn-start');
await new Promise((r) => setTimeout(r, 3000));

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
    meshes, waterMeshes, taps, lights, spawns,
  };
});

console.log('T+3s  ', JSON.stringify(await probe()));

// wait past the encounter director's first-spawn grace (45 s)
await new Promise((r) => setTimeout(r, 48000));
console.log('T+51s ', JSON.stringify(await probe()));

// check Level 37 water
await page.evaluate(() => window.__game.teleportToBiome(2));
await new Promise((r) => setTimeout(r, 2000));
console.log('L37   ', JSON.stringify(await probe()));

console.log(errors.length ? `ERRORS: ${errors.join(' | ')}` : 'NO PAGE ERRORS');
await browser.close();
