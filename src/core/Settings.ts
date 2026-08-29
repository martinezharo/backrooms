// The few knobs a player is allowed to turn, kept between runs.
//
// Best-effort, like Records: a browser with no storage keeps them for the
// session and forgets them afterwards rather than throwing.

const KEY = 'backrooms.settings.v1';

export interface Settings {
  /**
   * Look speed multiplier. 1 is the mouse default; a touchpad has an order of
   * magnitude less travel than a mousepad, so it wants two or three.
   */
  lookSpeed: number;
}

export const LOOK_SPEED_MIN = 0.4;
export const LOOK_SPEED_MAX = 4;

const DEFAULTS: Settings = { lookSpeed: 1 };

let memory: Settings | null = null;

/** Anything a hand-edited or half-written value could be, pulled back in range. */
function clean(raw: Partial<Settings>): Settings {
  const speed = Number(raw.lookSpeed);
  return {
    lookSpeed: Number.isFinite(speed)
      ? Math.min(LOOK_SPEED_MAX, Math.max(LOOK_SPEED_MIN, speed))
      : DEFAULTS.lookSpeed,
  };
}

/** Cached: this is read every frame by the look code. */
export function loadSettings(): Settings {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    memory = clean(raw ? JSON.parse(raw) as Partial<Settings> : {});
  } catch {
    memory = { ...DEFAULTS };
  }
  return memory;
}

/** Returns the value actually stored, which may have been clamped. */
export function setLookSpeed(value: number): number {
  const next = clean({ ...loadSettings(), lookSpeed: value });
  memory = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* no storage, keep it in memory for this session */
  }
  return next.lookSpeed;
}
