import { DEV_HACKS } from './core/dev';
import { formatTime } from './core/Records';
import { loadSave } from './core/Save';
import { setupTapeMenu } from './ui/TapeMenu';
import { BIOMES, DEPTHS } from './world/Biomes';

// An unfinished run remembers its own maze, so it also decides the seed —
// unless the URL asks for a specific one, which always wins.
const params = new URLSearchParams(location.search);
const save = loadSave();
const urlSeed = Number(params.get('seed'));
const askedForSeed = Number.isFinite(urlSeed) && urlSeed !== 0;
let seed = askedForSeed ? urlSeed : (save?.seed ?? (Math.random() * 0xffffffff) >>> 0);
setSeed(seed);
const canContinue = !!save && save.seed === seed;
setupTapeMenu(seed);

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
  // The floor you're standing on says more about a run than the clock does.
  const depth = Math.max(0, Math.min(DEPTHS.length - 1, save!.depth ?? 0));
  const level = BIOMES[DEPTHS[depth]].name;
  continueButton.textContent =
    `▶ Resume — ${level} · ${formatTime(save!.survivalTime)} in`;
  continueButton.classList.remove('hidden');
  startButton.textContent = 'START OVER';

  const resumeCopy = document.getElementById('tape-resume-copy');
  const resumeTime = document.getElementById('tape-resume-time');
  const resumeLevel = document.getElementById('tape-resume-level');
  const resumeFuses = document.getElementById('tape-resume-fuses');
  const resumeSeed = document.getElementById('tape-resume-seed');
  if (resumeCopy) resumeCopy.textContent = `You stopped on ${level}, ${formatTime(save!.survivalTime)} into tape ${save!.seed}. Nothing down there moves while the tape is stopped.`;
  if (resumeTime) resumeTime.textContent = formatTime(save!.survivalTime);
  if (resumeLevel) resumeLevel.textContent = level;
  if (resumeFuses) resumeFuses.textContent = `${save!.escapeFuses}/3`;
  if (resumeSeed) resumeSeed.textContent = String(save!.seed);
}

/**
 * Keep the landing page tiny. Three.js and the game systems are only fetched
 * after the player has explicitly chosen to enter the maze.
 */
async function bootGame(resume: boolean, trustedStart: boolean): Promise<void> {
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
    game = new GameClass(seed, trustedStart);

    // debug/testing hook (used by the headless smoke tests) — dev builds only
    if (DEV_HACKS) (window as unknown as { __game: Game }).__game = game;
    await game.start(resume);
  } catch (error) {
    console.error('Could not start the game', error);
    startButton.disabled = false;
    continueButton.disabled = false;
    button.textContent = resume ? label : 'TRY AGAIN';
    loading = false;
  }
}

startButton.addEventListener('click', (event) => { void bootGame(false, event.isTrusted); });
continueButton.addEventListener('click', (event) => { void bootGame(true, event.isTrusted); });
