// Start / pause / game-over screens.

export class Menus {
  private start = document.getElementById('start-screen')!;
  private pause = document.getElementById('pause-screen')!;
  private gameover = document.getElementById('gameover-screen')!;
  private cause = document.getElementById('gameover-cause')!;
  private stats = document.getElementById('gameover-stats')!;

  onStart: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onRestart: (() => void) | null = null;

  constructor() {
    document.getElementById('btn-start')!.addEventListener('click', () => this.onStart?.());
    document.getElementById('btn-resume')!.addEventListener('click', () => this.onResume?.());
    document.getElementById('btn-restart')!.addEventListener('click', () => this.onRestart?.());
    document.getElementById('btn-respawn')!.addEventListener('click', () => this.onRestart?.());
  }

  showStart(): void {
    this.start.classList.remove('hidden');
    this.pause.classList.add('hidden');
    this.gameover.classList.add('hidden');
  }

  hideAll(): void {
    this.start.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.gameover.classList.add('hidden');
  }

  showPause(visible: boolean): void {
    this.pause.classList.toggle('hidden', !visible);
  }

  showGameOver(cause: string, survivedSeconds: number): void {
    this.cause.textContent = cause === 'dehydration'
      ? 'your body gave out. nobody heard it.'
      : `the ${cause.toLowerCase()} found you.`;
    const m = Math.floor(survivedSeconds / 60);
    const s = Math.floor(survivedSeconds % 60);
    this.stats.textContent = `you survived ${m}m ${s.toString().padStart(2, '0')}s`;
    this.gameover.classList.remove('hidden');
  }
}
