import { DEV_HACKS } from './core/dev';
import { formatTime, loadRecords } from './core/Records';
import { loadSave } from './core/Save';
import { watchForTouch } from './ui/controls';
import { runLandingTape } from './ui/tape';
import { defForDepth } from './world/Biomes';

// Before the first pixel: the landing page has to describe thumbs to a phone
// and WASD to a desktop, and the game is not built until you press play.
watchForTouch();

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

/** A door says two things: what it is, and what is on the other side of it. */
function labelDoor(door: HTMLButtonElement, label: string, meta?: string): void {
  door.querySelector('.door-label')!.textContent = label;
  if (meta !== undefined) door.querySelector('.door-meta')!.textContent = meta;
}

runLandingTape();

// Whoever was here last left a mark on the wall. It was you.
const records = loadRecords();
if (records.runs > 0) {
  const line = document.getElementById('landing-records')!;
  line.textContent = records.escapes > 0
    ? `${records.escapes} escape${records.escapes > 1 ? 's' : ''} · ${records.runs} descents · best ${
      records.bestSeconds === null ? '—' : formatTime(records.bestSeconds)}`
    : `${records.runs} descent${records.runs > 1 ? 's' : ''} · deepest ${
      defForDepth(records.deepestLevel).name} · never made it out`;
  line.classList.remove('hidden');
}

if (canContinue) {
  // The floor you're standing on says more about a run than the clock does.
  const floor = defForDepth(save!.depth ?? 0).name;
  labelDoor(continueButton, 'Continue', `${floor} · ${formatTime(save!.survivalTime)} in`);
  continueButton.classList.remove('hidden');
  labelDoor(startButton, 'Start over', 'a maze you have not seen');
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
  const label = button.querySelector('.door-label')!.textContent ?? '';
  labelDoor(button, 'Descending…');

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
    labelDoor(button, resume ? label : 'Try again');
    loading = false;
  }
}

startButton.addEventListener('click', (event) => { void bootGame(false, event.isTrusted); });
continueButton.addEventListener('click', (event) => { void bootGame(true, event.isTrusted); });
