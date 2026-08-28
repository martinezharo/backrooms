// A static server for the built game, so the headless checks can run against
// the same bundle that gets deployed.
//
// `pnpm dev` is the wrong thing to point them at in CI: it serves unbundled
// source through Vite and the Cloudflare plugin opens a tunnel on start. This
// serves dist/client and nothing else.
//
// Usage: node scripts/serve.mjs [dir] [port]

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

export function startServer({ dir, port = 0 } = {}) {
  const root = path.resolve(dir ?? 'dist/client');
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    throw new Error(`no index.html in ${root} — run \`pnpm build\` first`);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(root, decodeURIComponent(url.pathname));

    // Never serve anything outside the build, whatever the path says.
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // Same single-page fallback the Worker's asset config uses.
      file = path.join(root, 'index.html');
    }

    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({
        url: `http://127.0.0.1:${actual}`,
        port: actual,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// Run directly: serve until killed.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startServer({
    dir: process.argv[2],
    port: Number(process.argv[3] ?? 5199),
  });
  console.log(`serving ${url}`);
}
