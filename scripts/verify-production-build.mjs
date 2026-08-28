// A production build must not expose the live Game object or retain the
// keyboard shortcuts used by the headless checks. Keep this in the build
// command itself so local deploys get the same protection as CI.

import fs from 'node:fs';
import path from 'node:path';

const assetsDir = path.resolve('dist/client/assets');
const forbidden = [
  { text: '__game', label: 'window.__game handle' },
  { text: 'PageDown', label: 'floor-down shortcut' },
  { text: 'PageUp', label: 'floor-up shortcut' },
  { text: 'Backslash', label: 'descent shortcut' },
  { text: 'DEV — THE EXIT', label: 'dev teleport message' },
];

if (!fs.existsSync(assetsDir)) {
  throw new Error(`production assets are missing: ${assetsDir}`);
}

const bundles = fs.readdirSync(assetsDir)
  .filter((name) => name.endsWith('.js'))
  .map((name) => path.join(assetsDir, name));

if (bundles.length === 0) {
  throw new Error(`production JavaScript is missing: ${assetsDir}`);
}

const leaks = [];
for (const file of bundles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const marker of forbidden) {
    if (source.includes(marker.text)) leaks.push(`${marker.label} in ${path.basename(file)}`);
  }
}

if (leaks.length > 0) {
  throw new Error(`development hooks survived the production build:\n- ${leaks.join('\n- ')}`);
}

console.log(`production bundle is free of ${forbidden.length} dev-only markers`);
