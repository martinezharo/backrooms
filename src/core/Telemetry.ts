import { DEV_HACKS } from './dev';

type TelemetryEvent = 'game_started' | 'engaged_session' | 'level_reached' | 'death' | 'escape';
type InputMode = 'keyboard' | 'touch';

const ENDPOINT = '/api/telemetry';
const SETTING_KEY = 'backrooms.telemetry.v1';
const ENGAGED_SECONDS = 45;
const ENGAGED_METRES = 5;

function telemetryDisabled(): boolean {
  const choice = new URLSearchParams(location.search).get('telemetry');
  try {
    if (choice === 'off') localStorage.setItem(SETTING_KEY, 'off');
    else if (choice === 'on') localStorage.removeItem(SETTING_KEY);
    return localStorage.getItem(SETTING_KEY) === 'off';
  } catch {
    return choice === 'off';
  }
}

function privacySignalEnabled(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return navigator.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

/**
 * Minimal gameplay telemetry. It sends no seed, save data, IP, fingerprint or
 * persistent identifier. The server adds only Cloudflare's two-letter country.
 */
export class Telemetry {
  private readonly enabled: boolean;
  private readonly sent = new Set<string>();
  private visibleSeconds = 0;
  private travelledMetres = 0;
  private lastTickAt = performance.now();
  private lastX: number | null = null;
  private lastZ: number | null = null;

  constructor(trustedStart: boolean) {
    this.enabled = trustedStart && !DEV_HACKS && !telemetryDisabled() && !privacySignalEnabled();
  }

  record(event: TelemetryEvent, depth: number, seconds: number, input: InputMode): void {
    this.sendOnce(event, event, depth, seconds, input);
  }

  level(depth: number, seconds: number, input: InputMode): void {
    this.sendOnce(`level:${depth}`, 'level_reached', depth, seconds, input);
  }

  update(
    x: number,
    z: number,
    active: boolean,
    moving: boolean,
    depth: number,
    seconds: number,
    input: InputMode,
  ): void {
    if (!this.enabled) return;

    const now = performance.now();
    const elapsed = Math.min(1, Math.max(0, (now - this.lastTickAt) / 1000));
    this.lastTickAt = now;

    if (this.lastX !== null && this.lastZ !== null && active && moving) {
      const step = Math.hypot(x - this.lastX, z - this.lastZ);
      // Ignore teleports between floors and resumed checkpoints.
      if (step < 3) this.travelledMetres += step;
    }
    this.lastX = x;
    this.lastZ = z;

    if (!active || document.visibilityState !== 'visible') return;
    this.visibleSeconds += elapsed;
    if (this.visibleSeconds >= ENGAGED_SECONDS && this.travelledMetres >= ENGAGED_METRES) {
      this.sendOnce('engaged', 'engaged_session', depth, seconds, input);
    }
  }

  private sendOnce(
    key: string,
    event: TelemetryEvent,
    depth: number,
    seconds: number,
    input: InputMode,
  ): void {
    if (!this.enabled || this.sent.has(key)) return;
    this.sent.add(key);

    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, depth, seconds: Math.round(seconds), input }),
      credentials: 'omit',
      keepalive: true,
    }).catch(() => undefined);
  }
}
