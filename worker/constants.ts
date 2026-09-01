export const TELEMETRY_PATH = '/api/telemetry';
export const MAX_BODY_BYTES = 512;

// Exported so a source-contract test can hold them against what the game
// actually sends. The client and Worker are separate bundles, so neither
// compiler can catch this drift on its own.
export const EVENTS = new Set([
  'game_started',
  'engaged_session',
  'level_reached',
  'death',
  'escape',
]);

export const INPUT_MODES = new Set(['keyboard', 'touch']);

export { LAST_DEPTH as MAX_DEPTH } from '../shared/floors';
