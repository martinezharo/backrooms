// Start / pause / game-over / escape screens.

import { formatTime, Records } from '../core/Records';

export class Menus {
  private start = document.getElementById('start-screen')!;
  private pause = document.getElementById('pause-screen')!;
  private gameover = document.getElementById('gameover-screen')!;
  private cause = document.getElementById('gameover-cause')!;
  private stats = document.getElementById('gameover-stats')!;
  private escape = document.getElementById('escape-screen')!;
  private escapeCause = document.getElementById('escape-cause')!;
  private escapeStats = document.getElementById('escape-stats')!;
  private escapeRecords = document.getElementById('escape-records')!;
  private pauseSaved = document.getElementById('pause-saved')!;
  private landingRecords = document.getElementById('landing-records')!;

  onStart: (() => void) | null = null;
  onContinue: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onSaveQuit: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  onNewSeed: (() => void) | null = null;

  constructor() {
    document.getElementById('btn-start')!.addEventListener('click', () => this.onStart?.());
    document.getElementById('btn-continue')!.addEventListener('click', () => this.onContinue?.());
    document.getElementById('btn-resume')!.addEventListener('click', () => this.onResume?.());
    document.getElementById('btn-save-quit')!.addEventListener('click', () => this.onSaveQuit?.());
    document.getElementById('btn-restart')!.addEventListener('click', () => this.onRestart?.());
    document.getElementById('btn-respawn')!.addEventListener('click', () => this.onRestart?.());
    document.getElementById('btn-again')!.addEventListener('click', () => this.onNewSeed?.());
    document.getElementById('btn-same-seed')!.addEventListener('click', () => this.onRestart?.());
  }

  showStart(): void {
    this.start.classList.remove('hidden');
    this.pause.classList.add('hidden');
    this.gameover.classList.add('hidden');
    this.escape.classList.add('hidden');
  }

  hideAll(): void {
    this.start.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.gameover.classList.add('hidden');
    this.escape.classList.add('hidden');
  }

  /** Pausing writes a checkpoint; say so, or say why it couldn't. */
  showPause(visible: boolean, saved = true): void {
    this.pause.classList.toggle('hidden', !visible);
    this.pauseSaved.textContent = saved
      ? 'run saved — you can close the tab and come back'
      : 'no storage in this browser — this run cannot be saved';
  }

  showGameOver(cause: string, survivedSeconds: number, fuses: number): void {
    this.cause.textContent = cause === 'dehydration'
      ? 'your body gave out. nobody heard it.'
      : `the ${cause.toLowerCase()} found you.`;
    const carried = fuses > 0
      ? ` · ${fuses} fuse${fuses > 1 ? 's' : ''} left on the floor with you`
      : '';
    this.stats.textContent = `you survived ${formatTime(survivedSeconds)}${carried}`;
    this.gameover.classList.remove('hidden');
  }

  showEscape(fuses: number, seconds: number, records: Records): void {
    this.escapeCause.textContent = fuses >= 3
      ? 'the door held all the way. you came out whole.'
      : fuses === 2
        ? 'two fuses. the door flickered — and let you through anyway.'
        : 'one fuse, one chance. it barely opened. you took it.';
    this.escapeStats.textContent =
      `${fuses}/3 fuses · out in ${formatTime(seconds)}`;

    const row = (label: string, value: string) => `<span>${label} <strong>${value}</strong></span>`;
    this.escapeRecords.innerHTML = [
      row('escapes', String(records.escapes)),
      row('descents', String(records.runs)),
      row('best time', records.bestSeconds === null ? '—' : formatTime(records.bestSeconds)),
      row('deepest', `${records.deepest} m`),
    ].join('');

    this.escape.classList.remove('hidden');
  }

  /** Little line of history on the landing page, once there is any. */
  showRecords(r: Records): void {
    if (r.runs === 0) return;
    this.landingRecords.classList.remove('hidden');
    this.landingRecords.textContent = r.escapes > 0
      ? `${r.escapes} escape${r.escapes > 1 ? 's' : ''} · ${r.runs} descents · best ${r.bestSeconds === null ? '—' : formatTime(r.bestSeconds)}`
      : `${r.runs} descent${r.runs > 1 ? 's' : ''} · never made it out`;
  }
}
