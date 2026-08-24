// The counter in the corner of every screen you are not playing on.
//
// All four screens are dressed as footage of the same descent, and the thing
// that sells that is a timecode that behaves like one: it runs on the landing
// page, where nothing has happened yet, and it stops dead on the three screens
// that are showing you a frame the game has already stopped drawing.

const FPS = 25;

/** HH:MM:SS:FF, the way a deck writes it. */
export function timecode(seconds: number, frames = 0): string {
  const whole = Math.max(0, Math.floor(seconds));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(whole / 3600))}:${p(Math.floor(whole / 60) % 60)}:${p(whole % 60)}:${p(frames % FPS)}`;
}

/** Write a frozen timecode into one screen's readout. */
export function stampTape(screen: HTMLElement, seconds: number): void {
  const slot = screen.querySelector<HTMLElement>('.tape-time');
  if (slot) slot.textContent = timecode(seconds, Math.floor(seconds * FPS) % FPS);
}

/**
 * Run the landing page's readout. It counts from the moment the page opened,
 * which is the only honest thing it could be counting.
 */
export function runLandingTape(): void {
  const screen = document.getElementById('start-screen');
  const slot = screen?.querySelector<HTMLElement>('.tape-time');
  if (!slot) return;

  const opened = performance.now();
  let raf = 0;
  const tick = (): void => {
    // stop the moment the landing page is gone — the game owns the tape now
    if (screen!.classList.contains('hidden')) return;
    const elapsed = (performance.now() - opened) / 1000;
    slot.textContent = timecode(elapsed, Math.floor(elapsed * FPS) % FPS);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else if (!screen!.classList.contains('hidden')) raf = requestAnimationFrame(tick);
  });
}
