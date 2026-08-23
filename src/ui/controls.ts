// Every control the game can ask you for, named once.
//
// A prompt that says "E — TAKE PIPE" is useless on a phone, and a phone that
// is told to press TAB has nowhere to press. So nothing in the game writes a
// key name by hand: it asks for a control by what it *does*, and this module
// answers with the key on a keyboard or the on-screen button on a touchscreen.
// The touch strings here are the same strings printed on the buttons, so the
// prompt and the thing you press always read the same.

export type Control =
  | 'use' | 'jump' | 'crouch' | 'run' | 'attack' | 'block' | 'drink'
  | 'bag' | 'drop' | 'torch' | 'receiver' | 'quick' | 'back' | 'pause';

const KEYBOARD: Record<Control, string> = {
  use: 'E',
  jump: 'SPACE',
  crouch: 'C',
  run: 'SHIFT',
  attack: 'LEFT CLICK',
  block: 'RIGHT CLICK',
  drink: 'RIGHT CLICK',
  bag: 'TAB',
  drop: 'G',
  torch: 'F',
  receiver: 'R',
  quick: '1–9 / WHEEL',
  back: 'ESC',
  pause: 'ESC',
};

const TOUCH: Record<Control, string> = {
  use: 'USE',
  jump: 'JUMP',
  crouch: 'CROUCH',
  run: 'PUSH THE STICK ALL THE WAY',
  attack: 'HIT',
  block: 'BLOCK',
  drink: 'THE DRINK BUTTON',
  bag: 'BAG',
  drop: 'DROP',
  torch: 'TORCH',
  receiver: 'SIGNAL',
  quick: 'THE BAR AT THE BOTTOM',
  back: '✕',
  pause: 'PAUSE',
};

let touch = false;

/**
 * Flip the whole interface into touch mode: the body class every stylesheet
 * reads, and the labels every prompt reads. Idempotent.
 */
export function setTouchControls(on: boolean): void {
  touch = on;
  document.body.classList.toggle('touch', on);
}

/** Coarse pointer with no hover = a finger. `?touch=1` / `?touch=0` overrides. */
export function prefersTouch(): boolean {
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced !== null) return forced !== '0';
  return matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/**
 * Decide at boot, not when the game starts: the landing page has to tell a
 * phone about thumbs and a desktop about WASD, and by then nothing has been
 * constructed yet. A touchscreen the media query talked us out of still flips
 * over the first time it is touched.
 */
export function watchForTouch(): void {
  if (prefersTouch()) setTouchControls(true);
  else window.addEventListener('touchstart', () => setTouchControls(true), { once: true, passive: true });
}

export function usingTouch(): boolean {
  return touch;
}

/** What this control is called on the device in front of you. */
export function ctrl(c: Control): string {
  return (touch ? TOUCH : KEYBOARD)[c];
}

/** "E — TAKE PIPE" on a keyboard, "USE — TAKE PIPE" on a phone. */
export function cue(c: Control, action: string): string {
  return `${ctrl(c)} — ${action}`;
}

/** Same, for the things you have to lean on rather than tap. */
export function holdCue(c: Control, action: string): string {
  return `HOLD ${ctrl(c)} — ${action}`;
}
