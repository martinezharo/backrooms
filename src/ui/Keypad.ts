// The keypad on the Level 2 stairwell door.
//
// Four digits, and the only place they exist is sprayed on a wall somewhere
// else on the floor. It submits on the fourth key so there is nothing to
// press afterwards — the door either opens or it tells you no.

export class Keypad {
  /** Return true to accept the code; false makes the pad refuse it out loud. */
  onSubmit: ((code: string) => boolean) | null = null;
  onClose: (() => void) | null = null;
  /** any key press at all — for the beep */
  onKey: ((accepted: boolean) => void) | null = null;

  open = false;

  private screen = document.getElementById('keypad-screen')!;
  private readout = document.getElementById('keypad-readout')!;
  private keys = document.getElementById('keypad-keys')!;
  private entered = '';
  private locked = false;

  constructor() {
    for (let d = 1; d <= 9; d++) this.addKey(String(d));
    this.addKey('⌫', () => this.rub());
    this.addKey('0');
    this.addKey('✕', () => this.hide());
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'Escape') { this.hide(); e.preventDefault(); return; }
      if (e.code === 'Backspace') {
        this.rub();
        e.preventDefault();
        return;
      }
      const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
      if (m) {
        this.press(m[1]);
        e.preventDefault();
      }
    });
  }

  private addKey(label: string, action?: () => void): void {
    const b = document.createElement('button');
    b.className = 'keypad-key';
    b.textContent = label;
    b.addEventListener('click', () => (action ? action() : this.press(label)));
    this.keys.appendChild(b);
  }

  /** Rub out the last digit — the ⌫ key and Backspace do the same thing. */
  private rub(): void {
    if (this.locked || !this.entered) return;
    this.entered = this.entered.slice(0, -1);
    this.draw();
    this.onKey?.(true);
  }

  private press(digit: string): void {
    if (this.locked || this.entered.length >= 4) return;
    this.entered += digit;
    this.onKey?.(true);
    this.draw();
    if (this.entered.length === 4) this.submit();
  }

  private submit(): void {
    const accepted = this.onSubmit?.(this.entered) ?? false;
    this.locked = true;
    this.readout.classList.toggle('ok', accepted);
    this.readout.classList.toggle('bad', !accepted);
    this.onKey?.(accepted);
    // let the colour land before the pad either closes or clears itself
    window.setTimeout(() => {
      this.readout.classList.remove('ok', 'bad');
      this.locked = false;
      if (accepted) this.hide();
      else {
        this.entered = '';
        this.draw();
      }
    }, accepted ? 700 : 620);
  }

  private draw(): void {
    const shown = [0, 1, 2, 3].map((i) => this.entered[i] ?? '—').join(' ');
    this.readout.textContent = shown;
  }

  show(): void {
    this.entered = '';
    this.locked = false;
    this.draw();
    this.screen.classList.remove('hidden');
    this.open = true;
  }

  hide(): void {
    if (!this.open) return;
    this.screen.classList.add('hidden');
    this.open = false;
    this.onClose?.();
  }
}
