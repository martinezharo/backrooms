import { Game } from './core/Game';

// World seed from the URL (?seed=...) so a run can be reproduced/restarted.
const params = new URLSearchParams(location.search);
let seed = Number(params.get('seed'));
if (!Number.isFinite(seed) || seed === 0) {
  seed = (Math.random() * 0xffffffff) >>> 0;
  params.set('seed', String(seed));
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

const game = new Game(seed);

// debug/testing hook (used by the headless smoke test)
(window as unknown as { __game: Game }).__game = game;
