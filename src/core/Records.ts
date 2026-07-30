// Persistent run history — the only thing you get to keep between descents.
// Best-effort: private-mode browsers just get an in-memory copy.

const KEY = 'backrooms.records.v1';

export interface Records {
  runs: number;
  escapes: number;
  /** fastest escape, seconds */
  bestSeconds: number | null;
  /** most fuses carried out in one run */
  bestFuses: number;
  /** furthest from spawn, metres */
  deepest: number;
}

const EMPTY: Records = { runs: 0, escapes: 0, bestSeconds: null, bestFuses: 0, deepest: 0 };

let memory: Records | null = null;

export function loadRecords(): Records {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    memory = raw ? { ...EMPTY, ...JSON.parse(raw) as Partial<Records> } : { ...EMPTY };
  } catch {
    memory = { ...EMPTY };
  }
  return memory;
}

function save(r: Records): void {
  memory = r;
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* no storage, keep it in memory for this session */
  }
}

export function noteRunStarted(): void {
  const r = loadRecords();
  save({ ...r, runs: r.runs + 1 });
}

export function noteDepth(metres: number): void {
  const r = loadRecords();
  if (metres > r.deepest + 1) save({ ...r, deepest: Math.round(metres) });
}

export function noteEscape(fuses: number, seconds: number): Records {
  const r = loadRecords();
  const next: Records = {
    ...r,
    escapes: r.escapes + 1,
    bestFuses: Math.max(r.bestFuses, fuses),
    bestSeconds: r.bestSeconds === null || seconds < r.bestSeconds ? seconds : r.bestSeconds,
  };
  save(next);
  return next;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}
