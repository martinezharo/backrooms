// On-screen controls for phones and tablets: a thumbstick that appears where
// you put your left thumb, a look pad on the right, and buttons that stand in
// for the keys. Everything feeds the same Input the keyboard writes to, so no
// system below this file knows the difference.

import { Input } from '../core/Input';

/** pixels from the stick centre to full tilt */
const STICK_RADIUS = 58;
/** dead centre, as a fraction of the radius — stops thumb jitter walking you */
const DEADZONE = 0.14;
/** touch drags cover less screen than a mouse does, so they count for more */
const LOOK_SCALE = 2.4;

interface Spec {
  /** doubles as the grid-area name in the action cluster */
  id: string;
  label: string;
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
  { id: 'run', label: 'RUN', toggle: 'ShiftLeft', cls: 'small' },
  { id: 'crouch', label: 'CROUCH', toggle: 'KeyC', cls: 'small' },
  { id: 'jump', label: 'JUMP', hold: 'Space' },
  { id: 'use', label: 'USE', hold: 'KeyE' },
  { id: 'block', label: 'BLOCK', button: 2 },
  { id: 'attack', label: 'HIT', button: 0, cls: 'big' },
];

/** Utility row along the top edge. */
const TOOLS: Spec[] = [
  { id: 'bag', label: 'BAG', hold: 'Tab', cls: 'small' },
  { id: 'torch', label: 'TORCH', hold: 'KeyF', cls: 'small' },
  { id: 'receiver', label: 'RCVR', hold: 'KeyR', cls: 'small' },
  { id: 'drop', label: 'DROP', hold: 'KeyG', cls: 'small' },
  { id: 'hug', label: 'H', hold: 'KeyH', cls: 'small' },
];

/** Coarse pointer with no hover = a finger. `?touch=1` / `?touch=0` overrides. */
function wantsTouch(): boolean {
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced !== null) return forced !== '0';
  return matchMedia('(hover: none) and (pointer: coarse)').matches;
}

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
  private buttons: { el: HTMLElement; spec: Spec }[] = [];

  private stickPointer: number | null = null;
  private stickX = 0;
  private stickY = 0;
  private lookPointer: number | null = null;
  private lookX = 0;
  private lookY = 0;

  constructor(input: Input) {
    this.input = input;
    if (wantsTouch()) this.enable();
    // a touchscreen the media query talked us out of still gets the controls
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
    document.body.classList.add('touch');
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
      id: 'pause', label: 'II', hold: 'Escape', cls: 'small',
    });
  }

  private addButton(parent: HTMLElement, spec: Spec): HTMLElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `touch-btn ${spec.cls ?? ''}`.trim();
    el.id = `touch-btn-${spec.id}`;
    el.textContent = spec.label;
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
    this.buttons.push({ el, spec });
    return el;
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

  private releaseButton(el: HTMLElement, spec: Spec): void {
    if (spec.toggle) return; // latched until the next tap
    el.classList.remove('held');
    if (spec.hold) this.input.setVirtualKey(spec.hold, false);
    if (spec.button !== undefined) this.input.setVirtualButton(spec.button, false);
  }

  private releaseAll(): void {
    for (const { el } of this.buttons) el.classList.remove('held', 'on');
    this.input.releaseVirtual();
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
  }

  private resetStick(): void {
    this.stickPointer = null;
    this.input.moveX = 0;
    this.input.moveY = 0;
    this.knob.style.transform = 'translate(0px, 0px)';
    this.stick.classList.remove('active');
    // park it back at the resting spot as a hint of where the stick lives
    this.stick.style.left = '';
    this.stick.style.top = '';
  }

  // -------------------------------------------------------------- look

  private wireLook(): void {
    this.lookZone.addEventListener('pointerdown', (e) => {
      if (this.lookPointer !== null) return;
      e.preventDefault();
      this.lookPointer = e.pointerId;
      this.lookZone.setPointerCapture(e.pointerId);
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    });
    this.lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointer) return;
      this.input.addLook((e.clientX - this.lookX) * LOOK_SCALE, (e.clientY - this.lookY) * LOOK_SCALE);
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.lookPointer) return;
      this.lookPointer = null;
    };
    this.lookZone.addEventListener('pointerup', end);
    this.lookZone.addEventListener('pointercancel', end);
  }
}
