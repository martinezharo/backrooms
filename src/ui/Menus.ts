// Start / pause / game-over / escape screens.
//
// Each one is a card of typed record lines over a room: nothing here decides
// what a screen looks like, it only decides what the record says.

import { formatTime, Records } from '../core/Records';
import { defForDepth } from '../world/Biomes';
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
  showPause(visible: boolean, saved = true, depth = 0, seconds = 0): void {
    this.pause.classList.toggle('hidden', !visible);
    if (!visible) return;

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
