import { formatTime } from './core/Records';
import { loadSave } from './core/Save';

// An unfinished run remembers its own maze, so it also decides the seed —
// unless the URL asks for a specific one, which always wins.
const params = new URLSearchParams(location.search);
const save = loadSave();
const urlSeed = Number(params.get('seed'));
const askedForSeed = Number.isFinite(urlSeed) && urlSeed !== 0;
let seed = askedForSeed ? urlSeed : (save?.seed ?? (Math.random() * 0xffffffff) >>> 0);
setSeed(seed);
const canContinue = !!save && save.seed === seed;

function setSeed(value: number): void {
  seed = value;
  params.set('seed', String(value));
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

type Game = import('./core/Game').Game;

const startButton = document.getElementById('btn-start') as HTMLButtonElement;
const continueButton = document.getElementById('btn-continue') as HTMLButtonElement;
let game: Game | null = null;
let loading = false;

if (canContinue) {
  const fuses = save!.inventory.items.filter((i) => i.item.id === 'fuse').length;
  continueButton.textContent = `CONTINUE — ${formatTime(save!.survivalTime)} IN`
    + (fuses > 0 ? ` · ${fuses}/3 FUSES` : '');
  continueButton.classList.remove('hidden');
  startButton.textContent = 'START OVER';
}

/**
 * Keep the landing page tiny. Three.js and the game systems are only fetched
 * after the player has explicitly chosen to enter the maze.
 */
async function bootGame(resume: boolean): Promise<void> {
  if (loading || game) return;
  loading = true;
  startButton.disabled = true;
  continueButton.disabled = true;
  const button = resume ? continueButton : startButton;
  const label = button.textContent;
  button.textContent = 'DESCENDING…';

  // starting over on top of a save means a new maze, not the one you gave up on
  if (!resume && canContinue && !askedForSeed) setSeed((Math.random() * 0xffffffff) >>> 0);

  try {
    const { Game: GameClass } = await import('./core/Game');
    game = new GameClass(seed);

    // debug/testing hook (used by the headless smoke tests)
    (window as unknown as { __game: Game }).__game = game;
    await game.start(resume);
  } catch (error) {
    console.error('Could not start the game', error);
    startButton.disabled = false;
    continueButton.disabled = false;
    button.textContent = resume ? label : 'TRY AGAIN';
    loading = false;
  }
}

startButton.addEventListener('click', () => { void bootGame(false); });
continueButton.addEventListener('click', () => { void bootGame(true); });
