// World geometry: a chunk is CELLS x CELLS cells of CELL meters each.
export const CELL = 2;
export const CELLS = 16;
export const CHUNK = CELL * CELLS; // 32 m

// Chunk streaming
export const LOAD_RADIUS = 3;   // chunks generated/rendered around the player
export const UNLOAD_RADIUS = 5; // chunks disposed beyond this

// Player
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.7;
export const PLAYER_CROUCH_HEIGHT = 1.15;
export const EYE_RATIO = 0.92; // eye height as fraction of body height
export const WALK_SPEED = 3.4;
export const RUN_SPEED = 5.4;
export const CROUCH_SPEED = 1.6;
export const SWIM_SPEED = 2.4;
export const JUMP_VELOCITY = 4.6;
export const GRAVITY = 16;

// Survival tuning
export const THIRST_DRAIN = 0.45;        // points/s (bar is 0..100)
export const THIRST_DRAIN_RUN_MULT = 5; // sprinting burns through the bar fast
export const TAP_DRINK_RATE = 7;         // points/s while drinking at a tap
export const POOL_DRINK_RATE = 18;       // points/s while submerged
export const HEALTH_REGEN = 1.2;         // points/s when thirst > 60
export const DEHYDRATION_BASE = 0.6;     // health drain at thirst 0, accelerates

// Combat
export const PUNCH_DAMAGE = 5;
export const PUNCH_COOLDOWN = 0.8;
export const PUNCH_RANGE = 1.9;
export const BLOCK_MULT = 0.45;

// Inventory
export const MAX_CARRY_WEIGHT = 10;
export const INV_COLS = 5;
export const INV_ROWS = 4;

export const WALL_THICKNESS = 0.24;
