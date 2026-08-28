// Runs the headless checks against a real build, start to finish, and returns
// a single exit code. This is what CI runs and what you should run before a
// deploy — `pnpm test` covers the logic, this covers the game.
//
//   pnpm test:e2e                 build, serve, run everything
//   pnpm test:e2e --no-build      reuse dist/ as it stands
//   pnpm test:e2e --only smoke,save
//
// The build is made with VITE_HACKS=dev on purpose: the checks drive the game
// through `window.__game`, which a production bundle does not have. It is the
// same code path otherwise — same bundler, same minification, same assets.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { startServer } from './serve.mjs';

const CHECKS = [
  { name: 'smoke', script: 'scripts/smoke.mjs', query: '?seed=1234' },
  { name: 'tour', script: 'scripts/tour.mjs', query: '?seed=1234' },
  { name: 'save', script: 'scripts/save.mjs', query: '?seed=1234' },
  { name: 'escape', script: 'scripts/escape.mjs', query: '?seed=1234' },
  { name: 'mobile', script: 'scripts/mobile.mjs', query: '?seed=1234&touch=1' },
  { name: 'graffiti', script: 'scripts/graffiti.mjs', query: '?seed=1234' },
];

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only'))?.split('=')[1]
  ?? (args.includes('--only') ? args[args.indexOf('--only') + 1] : null);
const wanted = only ? only.split(',').map((s) => s.trim()) : null;
const checks = wanted ? CHECKS.filter((c) => wanted.includes(c.name)) : CHECKS;

if (wanted) {
  const unknown = wanted.filter((n) => !CHECKS.some((c) => c.name === n));
  if (unknown.length) {
    console.error(`unknown check(s): ${unknown.join(', ')}`);
    console.error(`known: ${CHECKS.map((c) => c.name).join(', ')}`);
    process.exit(2);
  }
}

function run(command, argv, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, argv, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

if (!args.includes('--no-build')) {
  console.log('--- building (VITE_HACKS=dev)');
  const code = await run('pnpm', ['exec', 'vite', 'build'], { VITE_HACKS: 'dev' });
  if (code !== 0) {
    console.error('build failed');
    process.exit(code);
  }
}

// Every check writes screenshots; puppeteer will not create the directory.
const shots = process.env.SHOT_DIR ?? '/tmp';
fs.mkdirSync(shots, { recursive: true });

const server = await startServer({ dir: 'dist/client' });
console.log(`--- serving dist/client at ${server.url}\n`);

const results = [];
for (const check of checks) {
  console.log(`--- ${check.name}`);
  const started = Date.now();
  const code = await run('node', [check.script, `${server.url}/${check.query}`], { SHOT_DIR: shots });
  results.push({ ...check, code, seconds: ((Date.now() - started) / 1000).toFixed(1) });
  console.log('');
}

await server.close();

console.log('--- summary');
for (const r of results) {
  console.log(`  ${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.name.padEnd(10)} ${r.seconds}s`);
}
const failed = results.filter((r) => r.code !== 0);
console.log(failed.length ? `\n${failed.length} check(s) failed` : '\nall checks passed');
process.exit(failed.length ? 1 : 0);
