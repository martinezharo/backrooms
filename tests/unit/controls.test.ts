// Nothing in the game writes a key name by hand: it asks for a control and
// this module answers with a key or a thumb button. A control missing from
// either table is a prompt that reads "undefined — TAKE PIPE" on a real
// player's screen.

import { beforeEach, describe, expect, it, vi } from 'vitest';

type ControlsModule = typeof import('../../src/ui/controls');

/** Touch mode is module state, so each test gets its own module. */
async function fresh(search = ''): Promise<ControlsModule> {
  history.replaceState(null, '', `/${search}`);
  vi.resetModules();
  return import('../../src/ui/controls');
}

const CONTROLS = [
  'use', 'jump', 'crouch', 'run', 'attack', 'block', 'drink',
  'bag', 'drop', 'torch', 'receiver', 'quick', 'back', 'pause',
] as const;

beforeEach(() => { document.body.className = ''; });

describe('every control is named on both devices', () => {
  it('answers with a non-empty label on a keyboard', async () => {
    const { ctrl } = await fresh();
    for (const c of CONTROLS) expect(ctrl(c), `no keyboard label for ${c}`).toMatch(/\S/);
  });

  it('answers with a non-empty label on a touchscreen', async () => {
    const { ctrl, setTouchControls } = await fresh();
    setTouchControls(true);
    for (const c of CONTROLS) expect(ctrl(c), `no touch label for ${c}`).toMatch(/\S/);
  });

  it('never names a key on a device that has not got one', async () => {
    const { ctrl, setTouchControls } = await fresh();
    setTouchControls(true);
    const keyboardWords = /\b(WASD|SHIFT|SPACE|ESC|TAB|CLICK|WHEEL|MOUSE)\b/;
    for (const c of CONTROLS) expect(ctrl(c), `${c} names a key`).not.toMatch(keyboardWords);
  });
});

describe('setTouchControls', () => {
  it('flips the body class the stylesheets read', async () => {
    const { setTouchControls } = await fresh();
    setTouchControls(true);
    expect(document.body.classList.contains('touch')).toBe(true);
    setTouchControls(false);
    expect(document.body.classList.contains('touch')).toBe(false);
  });

  it('is idempotent', async () => {
    const { setTouchControls, usingTouch } = await fresh();
    setTouchControls(true);
    setTouchControls(true);
    expect(usingTouch()).toBe(true);
    expect(document.body.className.trim()).toBe('touch');
  });
});

describe('prefersTouch', () => {
  it('defaults to the media query', async () => {
    const { prefersTouch } = await fresh();
    expect(prefersTouch()).toBe(false);
  });

  it('lets ?touch=1 force it on', async () => {
    const { prefersTouch } = await fresh('?touch=1');
    expect(prefersTouch()).toBe(true);
  });

  it('lets ?touch=0 force it off on a real touchscreen', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const { prefersTouch } = await fresh('?touch=0');
    expect(prefersTouch()).toBe(false);
  });

  it('follows a coarse pointer when the URL says nothing', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const { prefersTouch } = await fresh();
    expect(prefersTouch()).toBe(true);
  });
});

describe('watchForTouch', () => {
  it('switches over the first time a finger lands, even if the query said no', async () => {
    const { watchForTouch, usingTouch } = await fresh();
    watchForTouch();
    expect(usingTouch()).toBe(false);
    window.dispatchEvent(new Event('touchstart'));
    expect(usingTouch()).toBe(true);
  });

  it('starts in touch mode when the URL asked for it', async () => {
    const { watchForTouch, usingTouch } = await fresh('?touch=1');
    watchForTouch();
    expect(usingTouch()).toBe(true);
  });
});

describe('cue / holdCue', () => {
  it('reads as the key on a keyboard', async () => {
    const { cue, holdCue } = await fresh();
    expect(cue('use', 'TAKE PIPE')).toBe('E — TAKE PIPE');
    expect(holdCue('use', 'DRINK')).toBe('HOLD E — DRINK');
  });

  it('reads as the on-screen button on a phone', async () => {
    const { cue, setTouchControls } = await fresh();
    setTouchControls(true);
    expect(cue('use', 'TAKE PIPE')).toBe('USE — TAKE PIPE');
  });
});
