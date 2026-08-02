// World seed from the URL (?seed=...) so a run can be reproduced/restarted.
const params = new URLSearchParams(location.search);
let seed = Number(params.get('seed'));
if (!Number.isFinite(seed) || seed === 0) {
  seed = (Math.random() * 0xffffffff) >>> 0;
  params.set('seed', String(seed));
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

type Game = import('./core/Game').Game;

const startButton = document.getElementById('btn-start') as HTMLButtonElement;
let game: Game | null = null;
let loading = false;

/**
 * Keep the landing page tiny. Three.js and the game systems are only fetched
 * after the player has explicitly chosen to enter the maze.
 */
async function bootGame(): Promise<void> {
  if (loading || game) return;
  loading = true;
  startButton.disabled = true;
  startButton.textContent = 'DESCENDING…';

  try {
    const { Game: GameClass } = await import('./core/Game');
    game = new GameClass(seed);

    // debug/testing hook (used by the headless smoke tests)
    (window as unknown as { __game: Game }).__game = game;
    await game.start();
  } catch (error) {
    console.error('Could not start the game', error);
    startButton.disabled = false;
    startButton.textContent = 'TRY AGAIN';
    loading = false;
  }
}

startButton.addEventListener('click', () => { void bootGame(); });
