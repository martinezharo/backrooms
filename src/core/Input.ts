// Keyboard + mouse state with Pointer Lock handling, plus the virtual keys,
// buttons and analog stick fed in by the on-screen touch controls.

/**
 * A wheel notch arrives as one event this big or bigger — Chrome sends 100 px,
 * Firefox 3 lines. Anything smaller is a touchpad gliding.
 */
const NOTCH_PX = 40;
/** Touchpad glide that adds up to one step: roughly two centimetres of finger. */
const GLIDE_PX = 80;
/** ...and no more often than this, which no amount of momentum can beat. */
const GLIDE_MS = 140;
/** Silence this long ends a gesture; anything sooner is still the same one. */
const GESTURE_MS = 120;
/** Line and page wheel deltas, in pixels, so one threshold can judge them all. */
const DELTA_MODE_PX = [1, 16, 400];
/** The keys that turn you, and that a browser would otherwise scroll with. */
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export class Input {
  private keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  /** codes held down by an on-screen button rather than a real key */
  private virtualKeys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  mouseDown = [false, false, false];
  mousePressed = [false, false, false];
  /** accumulated wheel steps this frame: +1 per notch down, -1 per notch up */
  wheelDelta = 0;
  /** touchpad glide banked toward the next step, in pixels */
  private glideAccum = 0;
  /** far enough back that the first glide of the session is never rate-limited */
  private lastGlide = -GLIDE_MS;
  /** while a glide is still running, everything belongs to it */
  private gestureEnds = 0;
  pointerLocked = false;
  /** analog stick: x = strafe, y = forward, each in [-1, 1] */
  moveX = 0;
  moveY = 0;
  /** on-screen controls are driving: never ask for pointer lock */
  touchMode = false;

  /** Fired when the browser drops pointer lock (e.g. user pressed Esc). */
  onPointerLockLost: (() => void) | null = null;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      // Keep TAB from moving browser focus, and the arrows — which turn you —
      // from scrolling, while playing. Held keys auto-repeat, and every repeat
      // is a fresh event with a default action of its own, so this cannot sit
      // behind the guard below: only the first press would ever be stopped.
      if (e.code === 'Tab' || (this.pointerLocked && ARROWS.has(e.code))) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedThisFrame.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = [false, false, false];
    });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDown[e.button] = true;
      this.mousePressed[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown[e.button] = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (!this.pointerLocked) return;
      this.takeWheel(e.deltaY * (DELTA_MODE_PX[e.deltaMode] ?? 1));
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      const lost = this.pointerLocked && !locked;
      this.pointerLocked = locked;
      if (lost) this.onPointerLockLost?.();
    });
  }

  async requestPointerLock(): Promise<void> {
    if (this.pointerLocked || this.touchMode) return;
    try {
      await this.canvas.requestPointerLock();
    } catch {
      // Browser may throw if called too soon after a previous exit; ignore.
    }
  }

  exitPointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  /**
   * One scroll gesture should move one slot, whatever produced it.
   *
   * A mouse says so plainly: one notch, one big event. A touchpad says it as a
   * drizzle of one- and two-pixel events, and then keeps saying it for another
   * second of momentum after the fingers have left the glass — counting those
   * one-for-one spins the whole inventory past on a single flick. So a notch
   * steps on its own, and everything smaller has to earn a step by distance,
   * no faster than a person could flick twice.
   */
  private takeWheel(px: number): void {
    if (px === 0) return;
    const now = performance.now();
    // A hard flick can throw single momentum events bigger than a notch, so
    // size alone is not enough: once a gesture has been seen gliding it keeps
    // that character until the events stop coming.
    const sameGesture = now < this.gestureEnds;
    if (Math.abs(px) >= NOTCH_PX && !sameGesture) {
      this.glideAccum = 0;
      this.wheelDelta += Math.sign(px);
      return;
    }
    // Distance banked by a gesture that has already ended is not this one's to
    // spend, and neither is distance travelled the other way: two nudges too
    // small to mean anything must not add up to a step between them.
    if (!sameGesture || Math.sign(px) !== Math.sign(this.glideAccum)) this.glideAccum = 0;
    this.gestureEnds = now + GESTURE_MS;
    this.glideAccum += px;
    if (Math.abs(this.glideAccum) < GLIDE_PX) return;
    // Earned but too soon: spend it anyway. Momentum that keeps re-earning the
    // distance is exactly what must not queue up steps for later.
    this.glideAccum = 0;
    if (now - this.lastGlide < GLIDE_MS) return;
    this.lastGlide = now;
    this.wheelDelta += Math.sign(px);
  }

  down(code: string): boolean {
    return this.keys.has(code) || this.virtualKeys.has(code);
  }

  /** True only on the frame the key went down. */
  pressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  // ------------------------------------------------ on-screen controls

  /** An on-screen button standing in for a key. Taps shorter than a frame
   *  still register, because the press edge is latched until endFrame. */
  setVirtualKey(code: string, down: boolean): void {
    if (down) {
      if (!this.virtualKeys.has(code)) this.pressedThisFrame.add(code);
      this.virtualKeys.add(code);
    } else {
      this.virtualKeys.delete(code);
    }
  }

  /** An on-screen button standing in for a mouse button (0 attack, 2 block). */
  setVirtualButton(button: number, down: boolean): void {
    if (down && !this.mouseDown[button]) this.mousePressed[button] = true;
    this.mouseDown[button] = down;
  }

  /** Look delta from a touch drag, in raw mouse-movement units. */
  addLook(dx: number, dy: number): void {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** Drop every virtual hold — used when the controls go away mid-press. */
  releaseVirtual(): void {
    this.virtualKeys.clear();
    this.mouseDown = [false, false, false];
    this.moveX = 0;
    this.moveY = 0;
  }

  /** Call at the end of each frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.mousePressed = [false, false, false];
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
  }
}
