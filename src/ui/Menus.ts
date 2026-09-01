// Start / pause / game-over / escape screens.
//
// Each one is a card of typed record lines over a room: nothing here decides
// what a screen looks like, it only decides what the record says.

import { formatTime, Records } from '../core/Records';
import { loadSettings, LOOK_SPEED_MAX, LOOK_SPEED_MIN, setLookSpeed } from '../core/Settings';
import { defForDepth } from '../world/Biomes';
import { usingTouch } from './controls';
import { stampTape } from './tape';

const levelName = (depth: number): string => defForDepth(depth).name;

/** One `LABEL ····· value` line of the typed record. */
function rows(into: HTMLElement, entries: [string, string][]): void {
  into.innerHTML = entries
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join('');
}

export class Menus {
  private start = document.getElementById('start-screen')!;
  private pause = document.getElementById('pause-screen')!;
  private pauseRecord = document.getElementById('pause-record')!;
  private pauseLevel = document.getElementById('pause-level')!;
  private gameover = document.getElementById('gameover-screen')!;
  private gameoverRecord = document.getElementById('gameover-record')!;
  private escape = document.getElementById('escape-screen')!;
  private escapeCause = document.getElementById('escape-cause')!;
  private escapeRecord = document.getElementById('escape-record')!;
  private escapeRecords = document.getElementById('escape-records')!;
  private pauseSaved = document.getElementById('pause-saved')!;
  private lookSpeed = document.getElementById('look-speed') as HTMLInputElement;
  private lookSpeedValue = document.getElementById('look-speed-value')!;
  private lookSpeedHint = document.getElementById('look-speed-hint')!;

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

    const { lookSpeed } = loadSettings();
    this.lookSpeed.min = String(LOOK_SPEED_MIN);
    this.lookSpeed.max = String(LOOK_SPEED_MAX);
    this.lookSpeed.value = String(lookSpeed);
    this.showLookSpeed(lookSpeed);
    this.lookSpeed.addEventListener('input', () => {
      this.showLookSpeed(setLookSpeed(Number(this.lookSpeed.value)));
    });
  }

  private showLookSpeed(value: number): void {
    this.lookSpeedValue.textContent = `${value.toFixed(1)}×`;
  }

  /**
   * The slider keeps keyboard focus after you drag it, and the arrows that turn
   * you would drag it again from inside the game. Hand focus back on the way out.
   */
  private dropFocus(): void {
    this.lookSpeed.blur();
  }

  showStart(): void {
    this.start.classList.remove('hidden');
    this.pause.classList.add('hidden');
    this.gameover.classList.add('hidden');
    this.escape.classList.add('hidden');
  }

  hideAll(): void {
    this.dropFocus();
    this.start.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.gameover.classList.add('hidden');
    this.escape.classList.add('hidden');
  }

  /** Pausing writes a checkpoint; say so, or say why it couldn't. */
  showPause(visible: boolean, saved = true, depth = 0, seconds = 0): void {
    this.pause.classList.toggle('hidden', !visible);
    if (!visible) {
      this.dropFocus();
      return;
    }

    this.lookSpeedHint.textContent = usingTouch()
      ? 'How far a drag turns you.'
      : 'How fast the mouse turns you — the arrow keys turn too.';
    rows(this.pauseRecord, [
      ['standing on', levelName(depth)],
      ['down here', formatTime(seconds)],
    ]);
    this.pauseLevel.textContent = levelName(depth).toLowerCase();
    stampTape(this.pause, seconds);
    this.pauseSaved.textContent = saved
      ? 'run saved — you can close the tab and come back'
      : 'no storage in this browser — this run cannot be saved';
  }

  showGameOver(cause: string, survivedSeconds: number, depth: number): void {
    rows(this.gameoverRecord, [
      ['cause', cause === 'dehydration'
        ? 'your body gave out. nobody heard it.'
        : cause === 'drowning'
          ? 'you ran out of air with the surface still above you.'
          : `the ${cause.toLowerCase()} found you.`],
      ['time survived', formatTime(survivedSeconds)],
      ['last floor', levelName(depth)],
    ]);
    stampTape(this.gameover, survivedSeconds);
    this.gameover.classList.remove('hidden');
  }

  showEscape(fuses: number, seconds: number, records: Records): void {
    this.escapeCause.textContent = fuses >= 3
      ? 'the door held all the way. you came out whole.'
      : fuses === 2
        ? 'two fuses. the door flickered — and let you through anyway.'
        : 'one fuse, one chance. it barely opened. you took it.';

    rows(this.escapeRecord, [
      ['fuses carried', `${fuses} of 3`],
      ['out in', formatTime(seconds)],
    ]);

    const cell = (label: string, value: string) => `<span>${label}<strong>${value}</strong></span>`;
    this.escapeRecords.innerHTML = [
      cell('escapes', String(records.escapes)),
      cell('descents', String(records.runs)),
      cell('best time', records.bestSeconds === null ? '—' : formatTime(records.bestSeconds)),
      cell('deepest', levelName(records.deepestLevel)),
    ].join('');

    stampTape(this.escape, seconds);
    this.escape.classList.remove('hidden');
  }
}
