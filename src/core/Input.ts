// Keyboard + mouse state with Pointer Lock handling.

export class Input {
  private keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  mouseDown = [false, false, false];
  mousePressed = [false, false, false];
  /** accumulated wheel steps this frame: +1 per notch down, -1 per notch up */
  wheelDelta = 0;
  pointerLocked = false;

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
    if (this.pointerLocked) return;
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
    return this.keys.has(code);
  }

  /** True only on the frame the key went down. */
  pressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
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
