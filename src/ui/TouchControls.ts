// On-screen controls for phones and tablets: a thumbstick that appears where
// you put your left thumb, a look pad on the right, and buttons that stand in
// for the keys. Everything feeds the same Input the keyboard writes to, so no
// system below this file knows the difference.
//
// Two rules shape the layout. Nothing is on screen that you cannot use right
// now — the torch button only exists once you own a torch — and every button
// says what it will do to the thing in your hand, not which key it replaces.

import { Input } from '../core/Input';
import { setTouchControls, usingTouch } from './controls';
import { controlIcon } from './icons';

/** pixels from the stick centre to full tilt */
const STICK_RADIUS = 58;
/** dead centre, as a fraction of the radius — stops thumb jitter walking you */
const DEADZONE = 0.14;
/** past this much tilt the thumb is at the rim, and the rim means run */
const RUN_TILT = 0.85;
/** touch drags cover less screen than a mouse does, so they count for more */
const LOOK_SCALE = 2.4;
/** how long a thumb has to sit still on the look pad to mean something else */
const LONG_PRESS_MS = 600;
/** and how far it may wander first before it is just a look, not a press */
const LONG_PRESS_SLOP = 14;

interface Spec {
  /** doubles as the grid-area name in the action cluster */
  id: string;
  label: string;
  /** icon key; with one set the button draws the glyph over the caption */
  icon?: string;
  /** key code held down while the button is held */
  hold?: string;
  /** key code latched on and off by successive taps */
  toggle?: string;
  /** mouse button held down while the button is held */
  button?: number;
  cls?: string;
}

/** Thumb cluster, bottom right. Laid out by grid-area = spec id. */
const ACTIONS: Spec[] = [
  { id: 'crouch', label: 'CROUCH', toggle: 'KeyC', cls: 'small' },
  { id: 'jump', label: 'JUMP', hold: 'Space' },
  { id: 'use', label: 'USE', hold: 'KeyE' },
  { id: 'block', label: 'BLOCK', button: 2 },
  { id: 'attack', label: 'HIT', button: 0, cls: 'big' },
];

/** Utility row along the top edge. Icons, because they never change. */
const TOOLS: Spec[] = [
  { id: 'bag', label: 'BAG', icon: 'bag', hold: 'Tab', cls: 'small' },
  { id: 'torch', label: 'TORCH', icon: 'torch', hold: 'KeyF', cls: 'small' },
  { id: 'receiver', label: 'DOOR', icon: 'signal', hold: 'KeyR', cls: 'small' },
  { id: 'drop', label: 'DROP', icon: 'drop', hold: 'KeyG', cls: 'small' },
];

/**
 * What the rig should be showing this frame. The game recomputes it every
 * frame; only the differences reach the DOM.
 */
export interface TouchContext {
  /** verb for the primary button — what the thing in your hand does */
  attack: string;
  /** verb for the secondary button, or null when the held item has none */
  secondary: string | null;
  /** something is in reach: the USE button lights up instead of sitting dead */
  usable: boolean;
  /** true = torch on, false = off, null = you don't have one */
  torch: boolean | null;
  /** what re-aiming the receiver would point you at, or null where a tap on it
   *  would change nothing */
  receiver: string | null;
  /** you are holding something that can be put down */
  drop: boolean;
}

const IDLE_CONTEXT: TouchContext = {
  attack: 'HIT', secondary: 'BLOCK', usable: false,
  torch: null, receiver: null, drop: false,
};

export class TouchControls {
  private input: Input;
  private root = document.getElementById('touch-controls')!;
  private moveZone = document.getElementById('touch-move-zone')!;
  private lookZone = document.getElementById('touch-look-zone')!;
  private stick = document.getElementById('touch-stick')!;
  private knob = document.getElementById('touch-stick-knob')!;
  private actions = document.getElementById('touch-actions')!;
  private tools = document.getElementById('touch-tools')!;

  private enabled = false;
  private active = false;
  private buttons = new Map<string, { el: HTMLElement; spec: Spec }>();
  private context: TouchContext = { ...IDLE_CONTEXT };

  private stickPointer: number | null = null;
  private stickX = 0;
  private stickY = 0;
  private running = false;
  private lookPointer: number | null = null;
  private lookX = 0;
  private lookY = 0;
  /** when the current look touch went down, and whether it has gone anywhere */
  private lookDownAt = 0;
  private lookTravelled = false;

  constructor(input: Input) {
    this.input = input;
    // main.ts has already made the call for the landing page; this only picks
    // it up, or waits for the first finger if it was a near miss
    if (usingTouch()) this.enable();
    else window.addEventListener('touchstart', () => this.enable(), { once: true, passive: true });
  }

  /** Show or hide the whole rig — called on every game state change. */
  setActive(active: boolean): void {
    this.active = active;
    if (!this.enabled) return;
    this.root.classList.toggle('hidden', !active);
    if (!active) this.releaseAll();
  }

  /** With the bag open only the tool row stays: the rest would eat the taps. */
  setBagOpen(open: boolean): void {
    if (!this.enabled) return;
    this.root.classList.toggle('bag-open', open);
    document.body.classList.toggle('bag-open', open);
    if (open) this.resetStick();
  }

  /**
   * Re-label and re-hide the buttons for what you are carrying and standing
   * next to. Cheap to call every frame: nothing is written unless it changed.
   */
  setContext(next: TouchContext): void {
    if (!this.enabled) return;
    const cur = this.context;
    if (next.attack !== cur.attack) this.setLabel('attack', next.attack);
    if (next.secondary !== cur.secondary) {
      this.show('block', next.secondary !== null);
      if (next.secondary) this.setLabel('block', next.secondary);
    }
    if (next.usable !== cur.usable) {
      this.buttons.get('use')?.el.classList.toggle('live', next.usable);
    }
    if (next.torch !== cur.torch) {
      this.show('torch', next.torch !== null);
      this.buttons.get('torch')?.el.classList.toggle('on', next.torch === true);
    }
    if (next.receiver !== cur.receiver) {
      this.show('receiver', next.receiver !== null);
      if (next.receiver) this.setLabel('receiver', next.receiver);
    }
    if (next.drop !== cur.drop) this.show('drop', next.drop);
    this.context = { ...next };
  }

  /** Phones play better full screen and sideways. Both are best-effort. */
  goImmersive(): void {
    if (!this.enabled || document.fullscreenElement) return;
    void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    void orientation?.lock?.('landscape').catch(() => {});
  }

  // ------------------------------------------------------------- setup

  private enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.input.touchMode = true;
    setTouchControls(true);
    this.build();
    this.wireStick();
    this.wireLook();
    this.resetStick();
    window.addEventListener('blur', () => this.releaseAll());
    this.root.classList.toggle('hidden', !this.active);
  }

  private build(): void {
    for (const spec of ACTIONS) this.addButton(this.actions, spec).style.gridArea = spec.id;
    for (const spec of TOOLS) this.addButton(this.tools, spec);
    this.addButton(document.getElementById('touch-pause')!, {
      id: 'pause', label: 'PAUSE', icon: 'pause', hold: 'Escape', cls: 'small',
    });
    // everything context-driven starts out of the way; the first frame of play
    // brings back whatever you actually have
    for (const id of ['torch', 'receiver', 'drop']) this.show(id, false);
  }

  private addButton(parent: HTMLElement, spec: Spec): HTMLElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `touch-btn ${spec.cls ?? ''}`.trim();
    el.id = `touch-btn-${spec.id}`;
    el.setAttribute('aria-label', spec.label);
    this.paint(el, spec, spec.label);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.pressButton(el, spec);
    });
    const release = () => this.releaseButton(el, spec);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    parent.appendChild(el);
    this.buttons.set(spec.id, { el, spec });
    return el;
  }

  /** Glyph over caption for the tools, plain caption for the thumb cluster. */
  private paint(el: HTMLElement, spec: Spec, label: string): void {
    el.innerHTML = spec.icon
      ? `<span class="touch-glyph">${controlIcon(spec.icon)}</span><span class="touch-cap">${label}</span>`
      : `<span class="touch-cap">${label}</span>`;
  }

  private setLabel(id: string, label: string): void {
    const found = this.buttons.get(id);
    if (!found) return;
    found.el.setAttribute('aria-label', label);
    this.paint(found.el, found.spec, label);
  }

  private show(id: string, visible: boolean): void {
    const found = this.buttons.get(id);
    if (!found) return;
    found.el.classList.toggle('gone', !visible);
    // a button that disappears mid-press would leave its key stuck down
    if (!visible) this.releaseButton(found.el, found.spec, true);
  }

  private pressButton(el: HTMLElement, spec: Spec): void {
    if (spec.toggle) {
      const on = !el.classList.contains('on');
      el.classList.toggle('on', on);
      this.input.setVirtualKey(spec.toggle, on);
      return;
    }
    el.classList.add('held');
    if (spec.hold) this.input.setVirtualKey(spec.hold, true);
    if (spec.button !== undefined) this.input.setVirtualButton(spec.button, true);
  }

  private releaseButton(el: HTMLElement, spec: Spec, force = false): void {
    if (spec.toggle) {
      if (!force) return; // latched until the next tap
      el.classList.remove('on');
      this.input.setVirtualKey(spec.toggle, false);
      return;
    }
    el.classList.remove('held');
    if (spec.hold) this.input.setVirtualKey(spec.hold, false);
    if (spec.button !== undefined) this.input.setVirtualButton(spec.button, false);
  }

  private releaseAll(): void {
    for (const { el } of this.buttons.values()) el.classList.remove('held', 'on');
    this.input.releaseVirtual();
    this.lookTravelled = true; // whatever was mid-press does not survive this
    this.resetStick();
  }

  // ------------------------------------------------------------- stick

  private wireStick(): void {
    this.moveZone.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      e.preventDefault();
      this.stickPointer = e.pointerId;
      this.moveZone.setPointerCapture(e.pointerId);
      this.stickX = e.clientX;
      this.stickY = e.clientY;
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.stick.classList.add('active');
      this.tiltStick(e.clientX, e.clientY);
    });
    this.moveZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointer) return;
      this.tiltStick(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.resetStick();
    };
    this.moveZone.addEventListener('pointerup', end);
    this.moveZone.addEventListener('pointercancel', end);
  }

  private tiltStick(x: number, y: number): void {
    const dx = x - this.stickX;
    const dy = y - this.stickY;
    const mag = Math.hypot(dx, dy);
    const clamp = mag > STICK_RADIUS ? STICK_RADIUS / mag : 1;
    const kx = dx * clamp;
    const ky = dy * clamp;
    this.knob.style.transform = `translate(${kx}px, ${ky}px)`;

    let ax = kx / STICK_RADIUS;
    let ay = -ky / STICK_RADIUS; // screen y grows downward, forward doesn't
    const tilt = Math.hypot(ax, ay);
    if (tilt < DEADZONE) {
      ax = 0;
      ay = 0;
    } else {
      // rescale so the axis still reaches 1.0 at the rim after the deadzone
      const s = (tilt - DEADZONE) / (1 - DEADZONE) / tilt;
      ax *= s;
      ay *= s;
    }
    this.input.moveX = ax;
    this.input.moveY = ay;
    // shoving the thumb out to the rim is the sprint: one fewer button, and
    // it is the same gesture every phone game already taught you
    this.setRunning(tilt >= RUN_TILT);
  }

  private setRunning(on: boolean): void {
    if (on === this.running) return;
    this.running = on;
    this.input.setVirtualKey('ShiftLeft', on);
    this.stick.classList.toggle('running', on);
  }

  private resetStick(): void {
    this.stickPointer = null;
    this.input.moveX = 0;
    this.input.moveY = 0;
    this.setRunning(false);
    this.knob.style.transform = 'translate(0px, 0px)';
    this.stick.classList.remove('active');
    // park it back at the resting spot as a hint of where the stick lives
    this.stick.style.left = '';
    this.stick.style.top = '';
  }

  // -------------------------------------------------------------- look

  private wireLook(): void {
    let downX = 0;
    let downY = 0;
    this.lookZone.addEventListener('pointerdown', (e) => {
      if (this.lookPointer !== null) return;
      e.preventDefault();
      this.lookPointer = e.pointerId;
      this.lookZone.setPointerCapture(e.pointerId);
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      downX = e.clientX;
      downY = e.clientY;
      this.lookDownAt = performance.now();
      this.lookTravelled = false;
    });
    this.lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointer) return;
      this.input.addLook((e.clientX - this.lookX) * LOOK_SCALE, (e.clientY - this.lookY) * LOOK_SCALE);
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      // a thumb that is going somewhere is looking around, not holding still
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > LONG_PRESS_SLOP) this.lookTravelled = true;
    });
    const end = (e: PointerEvent, lifted: boolean) => {
      if (e.pointerId !== this.lookPointer) return;
      this.lookPointer = null;
      if (lifted) this.finishLookPress();
    };
    this.lookZone.addEventListener('pointerup', (e) => end(e, true));
    this.lookZone.addEventListener('pointercancel', (e) => end(e, false));
  }

  /**
   * The hug is an easter egg, and an egg with a button on it is a feature. On
   * a keyboard it is an unmarked key; here it is holding still and staring at
   * whatever is standing over you — which does nothing at all unless there is
   * something within arm's reach, so nobody finds it by fumbling.
   *
   * The verdict is passed when the thumb lifts rather than on a timer: a
   * struggling frame rate delivers pointer moves in clumps, and a timer cannot
   * tell a slow drag from a still thumb until the moves have arrived.
   */
  private finishLookPress(): void {
    if (this.lookTravelled || performance.now() - this.lookDownAt < LONG_PRESS_MS) return;
    this.input.setVirtualKey('KeyH', true);
    // long enough for the simulation to see the press edge, short enough that
    // it can never be mistaken for a key left down
    window.setTimeout(() => this.input.setVirtualKey('KeyH', false), 140);
  }
}
