// Keyboard + mouse state with Pointer Lock handling, plus the virtual keys,
// buttons and analog stick fed in by the on-screen touch controls.

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
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedThisFrame.add(e.code);
      // Keep TAB from moving browser focus while playing.
      if (e.code === 'Tab') e.preventDefault();
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
      this.wheelDelta += Math.sign(e.deltaY);
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
