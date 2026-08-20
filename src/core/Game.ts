// Game orchestrator: owns every system, the state machine and the main loop.

import * as THREE from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { Music } from '../audio/Music';
import { Enemy, EnemyContext } from '../enemies/Enemy';
import { Spawner } from '../enemies/Spawner';
import { Inventory } from '../items/Inventory';
import { ItemInstance, makeItem } from '../items/Items';
import { Pickups } from '../items/Pickups';
import { Combat, CombatSound } from '../player/Combat';
import { Player } from '../player/Player';
import { Stats } from '../player/Stats';
import { Lighting } from '../rendering/Lighting';
import { PostFX } from '../rendering/PostFX';
import { updateWater } from '../rendering/Water';
import { Escape } from '../rendering/Escape';
import { BiomeId, BIOMES, LAST_DEPTH, defForDepth } from '../world/Biomes';
import { CarSpot } from '../world/Chunk';
import {
  DescentManager, chunkCentre, descentKind, descentLayout,
} from '../world/Descent';
import { FUSE_COUNT, objectiveLayout } from '../world/Objective';
import { PortalManager } from '../world/Portal';
import { World } from '../world/World';
import {
  BATTERY_CHARGE, BOTTLE_CAPACITY, BOTTLE_DRINK_RATE, CHUNK, PLAYER_HEIGHT, RUN_SPEED,
} from './constants';
import { HUD, ObjectiveView } from '../ui/HUD';
import { InventoryUI } from '../ui/InventoryUI';
import { Keypad } from '../ui/Keypad';
import { Menus } from '../ui/Menus';
import { TouchControls } from '../ui/TouchControls';
import { DEV_HACKS } from './dev';
import { Input } from './Input';
import { loadRecords, noteDepth, noteEscape, noteLevel, noteRunStarted } from './Records';
import { clearSave, DescentState, loadSave, SaveGame, writeSave } from './Save';
import { Telemetry } from './Telemetry';
import { getRenderQuality } from '../rendering/Quality';

type GameState = 'menu' | 'playing' | 'paused' | 'dead' | 'escaping' | 'escaped';

const SPAWN_X = 17;
const SPAWN_Z = 17;

/** torch runs ~5 minutes on one battery */
const TORCH_DRAIN = 100 / 300;
/** servings in one almond water machine */
const VENDING_SERVINGS = 3;
/** seconds between autosaves — the checkpoint is never more than this stale */
const AUTOSAVE_EVERY = 20;

// ---- what each floor charges to let you through ----
/** seconds of leaning on the soft place before Level 0 gives up */
const SOFTWALL_PUSH = 3.2;
/** alarms that have to be going off at the same time to wake the shutter */
const ALARMS_NEEDED = 4;
/** how long one car keeps screaming before it gives up and re-arms */
const ALARM_TIME = 42;
/** seconds of turning the main valve before the poolrooms start filling */
const VALVE_TURN = 3.4;
/** metres Level 37's water climbs once it is running, and how fast */
const FLOOD_HEIGHT = 2.6;
const FLOOD_RATE = 2.6 / 50;
/** the water has to be over the rim before the drain has anything to pull with */
const FLOOD_OPENS_DRAIN = 1.6;
/** seconds of cranking the hatch wheel — more than one breath holds */
const HATCH_CRANK = 12;
/** seconds of black between one floor and the next */
const FADE_TIME = 1.5;

const EMPTY_DESCENT: DescentState = { progress: 0, open: false, flood: 0, codeKnown: false };

export class Game {
  private state: GameState = 'menu';
  private renderer: THREE.WebGLRenderer;
  private quality = getRenderQuality();
  private scene = new THREE.Scene();
  private input: Input;
  private world: World;
  private player: Player;
  private stats = new Stats();
  private inventory = new Inventory();
  private pickups: Pickups;
  private combat: Combat;
  private spawner: Spawner;
  private lighting: Lighting;
  private postfx: PostFX;
  private audio = new AudioEngine();
  private music: Music;
  private hud = new HUD();
  private invUI: InventoryUI;
  private menus = new Menus();
  private touch: TouchControls;

  private seed: number;
  private time = 0;
  private survivalTime = 0;
  private lastFrame = performance.now();
  private gulpTimer = 0;
  private damageOverlay = 0;
  private expectUnlock = false;
  private lastStingerAt = -99;
  private lastWhisperAt = -99;
  private fogColor = new THREE.Color(BIOMES[BiomeId.Level0].fogColor);
  private fogTargetColor = new THREE.Color(BIOMES[BiomeId.Level0].fogColor);
  private fog: THREE.FogExp2;
  private message = '';
  private messageTimer = 0;

  // ---- the way down ----
  /** index into DEPTHS: which floor of the building is under your feet */
  private depth = 0;
  private descent: DescentState = { ...EMPTY_DESCENT };
  private descentMgr: DescentManager;
  private keypad = new Keypad();
  /** car id → seconds of screaming left in it */
  private alarms = new Map<string, number>();
  /** 0 = playing, 1 = fully black; sign of `fadeDir` says which way it's going */
  private fade = 0;
  private fadeDir = 0;
  private pendingDepth = -1;
  /** the Esc that closed the keypad must not also open the pause menu */
  private swallowEscape = false;

  // ---- the way out ----
  private portals: PortalManager;
  private escape = new Escape();
  private escapeFuses = 0;
  private portalOpened = false;
  private torchCharge = 100;
  private vendingLeft = new Map<string, number>();
  private receiverOnExit = false;
  private saveTimer = AUTOSAVE_EVERY;
  /** set on the way out: the loop stops asking for frames */
  private stopped = false;
  private pingTimer = 0;
  private depthTimer = 0;
  /** throttles the metal-on-metal groan while something is being cranked */
  private valveGroan = 0;
  /** seconds until the live car alarms all yelp again */
  private alarmChirp = 0;
  /** seconds until the next beat, once the breath is nearly gone */
  private heartTimer = 0;
  /** 0..1 — how much noise you have made lately; decays over about a minute */
  private noiseHeat = 0;
  private readonly viewDirection = new THREE.Vector3();
  private readonly enemyOffset = new THREE.Vector3();
  private readonly objectiveForward = new THREE.Vector3();
  private readonly telemetry: Telemetry;

  constructor(seed: number, trustedStart = false) {
    this.seed = seed;
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.quality.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.quality.mobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.fog = new THREE.FogExp2(this.fogColor.getHex(), BIOMES[BiomeId.Level0].fogDensity);
    this.scene.fog = this.fog;
    this.scene.background = this.fogColor;

    this.input = new Input(canvas);
    this.touch = new TouchControls(this.input);
    this.telemetry = new Telemetry(trustedStart);
    this.player = new Player(window.innerWidth / window.innerHeight);
    this.player.camera.add(this.audio.listener);

    this.world = new World(seed, this.scene);
    this.pickups = new Pickups(this.scene, this.world);
    this.portals = new PortalManager(this.scene, this.world, seed);
    this.descentMgr = new DescentManager(this.scene, this.world, descentLayout(seed, 0).code);
    this.audio.attachStage(this.scene);
    this.lighting = new Lighting(this.scene, this.world, this.quality);
    this.combat = new Combat(this.scene, this.player, this.inventory);
    this.spawner = new Spawner(this.scene, this.world);
    this.postfx = new PostFX(this.renderer, this.scene, this.player.camera, this.quality);
    this.music = new Music(this.audio);
    this.invUI = new InventoryUI(this.inventory);

    this.wireEvents();

    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setSize(w, h);
      this.postfx.setSize(w, h);
      this.escape.setSize(w, h);
      this.player.camera.aspect = w / h;
      this.player.camera.updateProjectionMatrix();
    });

    // closing the tab is the most common way to stop playing; don't let it
    // cost the twenty seconds since the last autosave
    window.addEventListener('pagehide', () => {
      if (this.state === 'playing' || this.state === 'paused') this.saveRun();
    });

    this.menus.showRecords(loadRecords());
    this.menus.showStart();
    requestAnimationFrame(() => this.loop());
  }

  /** Called by the small landing-page bootstrap after the game chunk loads. */
  public async start(resume = false): Promise<void> {
    await this.startGame(resume ? loadSave() : null);
  }

  // ------------------------------------------------------------ wiring

  private wireEvents(): void {
    this.menus.onStart = () => this.startGame();
    this.menus.onContinue = () => this.startGame(loadSave());
    this.menus.onResume = () => this.resume();
    this.menus.onSaveQuit = () => this.saveAndQuit();
    this.menus.onRestart = () => {
      clearSave();
      const url = new URL(location.href);
      url.searchParams.set('seed', String(this.seed));
      location.href = url.toString();
    };
    this.menus.onNewSeed = () => {
      clearSave();
      const url = new URL(location.href);
      url.searchParams.set('seed', String((Math.random() * 0xffffffff) >>> 0));
      location.href = url.toString();
    };

    this.input.onPointerLockLost = () => {
      if (this.state === 'playing' && !this.expectUnlock) this.pauseGame();
      this.expectUnlock = false;
    };

    this.stats.onDamage = () => {
      this.postfx.triggerDamage(1);
      this.damageOverlay = 1;
      this.audio.playSfx('punch', 0.7, 0.25);
    };
    this.stats.onDeath = (cause) => {
      this.state = 'dead';
      clearSave(); // a checkpoint is for putting the game down, not for dying twice
      this.telemetry.record('death', this.depth, this.survivalTime, this.inputMode());

      this.expectUnlock = true;
      this.input.exitPointerLock();
      this.touch.setActive(false);
      this.invUI.setOpen(false);
      this.keypad.hide();
      this.hud.setPrompt(null);
      this.menus.showGameOver(cause, this.survivalTime, this.depth);
    };
    this.stats.onBreath = () => this.audio.playSfx('gasp', 0.55);

    this.keypad.onKey = (ok) => this.audio.playSfx(ok ? 'beep' : 'deny', 0.5);
    this.keypad.onSubmit = (entered) => {
      const right = entered === descentLayout(this.seed, this.depth).code;
      if (right) this.openTheWayDown();
      else this.noiseHeat = Math.min(1, this.noiseHeat + 0.45); // it was listening
      return right;
    };
    this.keypad.onClose = () => {
      // Esc closes the pad through its own listener, and the same key press is
      // still sitting in the input buffer this frame — without this it would
      // close the pad and open the pause menu in one keystroke.
      this.swallowEscape = true;
      if (this.state !== 'playing') return;
      this.touch.setActive(true);
      void this.input.requestPointerLock();
    };

    this.combat.onSound = (s: CombatSound) => {
      if (s === 'spray') this.audio.startSprayLoop();
      else if (s === 'sprayStop') this.audio.stopSprayLoop();
      else this.audio.playSfx(s, s === 'gunshot' ? 0.9 : 0.6);
    };
    this.combat.onMessage = (m) => this.flashMessage(m);

    // In water a stride doesn't land, it shoves: the wade loop swells instead
    // of a step being dropped on top of it.
    this.player.onFootstep = (s, intensity, inWater) => {
      if (inWater) this.audio.wadeSurge(0.4 + intensity * 0.6);
      else this.audio.footstep(s, intensity);
    };
    this.player.onLand = (s, impact, inWater) => this.audio.land(s, impact, inWater);
    this.player.onSplash = () => this.audio.playSfx('splash', 0.6);

    this.invUI.onDrop = (item) => this.dropItem(item);

    this.hud.onSlotTap = (i) => {
      const placed = this.inventory.items[i];
      if (!placed) return;
      this.inventory.equip(placed.item);
      this.audio.playSfx('click', 0.35);
    };
  }

  /** Scary noises are reserved for AI moments: stalking whispers and the
   *  stinger when something commits to coming for you. Globally throttled. */
  private onEnemyCue(e: Enemy, intensity: number): void {
    if (intensity >= 1) {
      if (this.time - this.lastStingerAt < 8) return;
      this.lastStingerAt = this.time;
      this.audio.playSfx('stinger', 0.85);
      this.audio.playCueAt(this.enemyCue(e, 'commit'), e.mesh, 0.9, 5);
      this.music.spike();
    } else {
      if (this.time - this.lastWhisperAt < 6) return;
      this.lastWhisperAt = this.time;
      this.audio.playCueAt(this.enemyCue(e, 'stalk'), e.mesh, 0.35, 4);
    }
  }

  private enemyCue(e: Enemy, kind: 'stalk' | 'commit'): string {
    switch (e.voiceId) {
      case 'smiler': return kind === 'stalk' ? 'whisper' : 'voice_smiler';
      case 'stealer': return kind === 'stalk' ? 'voice_stealer' : 'growl';
      case 'hound': return kind === 'stalk' ? 'voice_hound' : 'growl';
      case 'partygoer': return 'voice_partygoer';
    }
  }

  // ------------------------------------------------------- state changes

  private async startGame(save: SaveGame | null = null): Promise<void> {
    this.menus.hideAll();
    await this.audio.resume();
    this.music.start();

    // a save describes one maze; a different seed is a different maze
    const resumed = save && save.seed === this.seed ? save : null;

    this.depth = resumed ? Math.max(0, Math.min(LAST_DEPTH, resumed.depth)) : 0;
    this.descent = resumed ? { ...EMPTY_DESCENT, ...resumed.descent } : { ...EMPTY_DESCENT };
    this.alarms.clear();
    this.world.setDepth(this.depth);
    this.world.setWaterRise(this.descent.flood);
    this.portals.reset();
    this.descentMgr.reset(descentLayout(this.seed, this.depth).code);

    // Everything the chunk loader consults has to be back in place before the
    // first chunk exists: taken spawns, items left on the floor, the door.
    this.pickups.reset();
    this.spawner.reset();
    if (resumed) {
      this.pickups.loadState(resumed.pickups);
      if (resumed.portalOpen) this.portals.setOpen();
    }

    // Build the whole visible radius up front. Streaming it in afterwards only
    // moves the cost into the first seconds of play, where it shows up as
    // stutter and geometry popping in inside the view distance.
    const x = resumed ? resumed.player.x : SPAWN_X;
    const z = resumed ? resumed.player.z : SPAWN_Z;
    this.world.preload(x, z);

    if (resumed) {
      this.player.loadState(resumed.player);
      this.stats.loadState(resumed.stats);
      this.inventory.loadState(resumed.inventory);
      this.spawner.loadState(resumed.friends);
      this.time = resumed.time;
      this.survivalTime = resumed.survivalTime;
      this.torchCharge = resumed.torchCharge;
      this.lighting.setFlashlight(resumed.torchOn && resumed.torchCharge > 1);
      this.receiverOnExit = resumed.receiverOnExit;
      this.vendingLeft = new Map(resumed.vending);
      this.escapeFuses = resumed.escapeFuses;
      this.portalOpened = resumed.portalOpen;
      if (this.descent.open) this.descentMgr.clearBlocker();
      this.flashMessage('YOU WERE HERE BEFORE');
    } else {
      this.player.reset(SPAWN_X, SPAWN_Z);
      this.stats.reset();
      this.survivalTime = 0;
      this.torchCharge = 100;

      // You wake up already kitted: torch in hand (off — F is yours to press)
      // and the receiver in the bag. Neither is worth a scavenger hunt, so
      // neither spawns in the world.
      this.inventory.clear();
      this.inventory.add(makeItem('flashlight'));
      this.inventory.add(makeItem('detector'));
      this.lighting.setFlashlight(false);

      this.vendingLeft.clear();
      this.receiverOnExit = false;
      this.escapeFuses = 0;
      this.portalOpened = false;
      clearSave(); // a fresh descent buries whatever run was waiting
      noteRunStarted();
    }
    this.combat.reset();
    this.saveTimer = AUTOSAVE_EVERY;
    this.fade = 0;
    this.fadeDir = 0;
    this.pendingDepth = -1;
    this.hud.setFade(0);
    this.hud.showLevelCard(defForDepth(this.depth).name, defForDepth(this.depth).tagline);

    this.hud.show(true);
    this.state = 'playing';
    this.telemetry.record('game_started', this.depth, this.survivalTime, this.inputMode());
    this.audio.prepareWhenIdle();
    this.touch.goImmersive();
    this.touch.setBagOpen(false);
    this.touch.setActive(true);
    void this.input.requestPointerLock();
  }

  /**
   * The checkpoint. Nothing about the maze goes in — it regenerates from the
   * seed — only what the level can't work out again on its own.
   */
  private saveRun(): boolean {
    return writeSave({
      seed: this.seed,
      depth: this.depth,
      descent: this.descent,
      time: this.time,
      survivalTime: this.survivalTime,
      player: this.player.saveState(),
      stats: this.stats.saveState(),
      inventory: this.inventory.saveState(),
      pickups: this.pickups.saveState(),
      friends: this.spawner.saveState(),
      torchCharge: this.torchCharge,
      torchOn: this.lighting.flashlightOn,
      receiverOnExit: this.receiverOnExit,
      vending: [...this.vendingLeft],
      portalOpen: this.portalOpened,
      escapeFuses: this.escapeFuses,
    });
  }

  private pauseGame(): void {
    if (this.state !== 'playing') return;
    this.keypad.hide();
    const saved = this.saveRun();
    this.state = 'paused';
    // Esc usually drops the lock itself, but not every route into the pause
    // menu does — and a locked pointer can't click a button.
    this.expectUnlock = true;
    this.input.exitPointerLock();
    this.touch.setActive(false);
    this.menus.showPause(true, saved);
    void this.audio.suspend();
  }

  /**
   * Back to the landing page, where the run is waiting under CONTINUE. The
   * renderer and the world go down first: navigating away from a live WebGL
   * context leaves the browser holding it while the new page builds another.
   */
  private saveAndQuit(): void {
    this.saveRun();
    this.stopped = true;
    this.input.exitPointerLock();
    this.touch.setActive(false);
    void this.audio.suspend();
    this.world.dispose();
    this.renderer.dispose();
    location.reload();
  }

  private async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    this.menus.showPause(false);
    await this.audio.resume();
    this.state = 'playing';
    this.touch.setActive(true);
    void this.input.requestPointerLock();
  }

  private flashMessage(m: string): void {
    this.message = m;
    this.messageTimer = 2.2;
  }

  // -------------------------------------------------------------- loop

  private loop(): void {
    if (this.stopped) return;
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    // simulation dt is clamped so a stall can't teleport anything; the FPS
    // counter needs the real frame time, or it just reports 1/clamp
    const frameSeconds = (now - this.lastFrame) / 1000;
    const dt = Math.min(0.05, frameSeconds);
    this.lastFrame = now;

    if (this.state === 'playing') {
      this.time += dt;
      this.survivalTime += dt;
      this.updatePlaying(dt);
    } else if (this.state === 'dead') {
      this.time += dt;
      // world keeps breathing behind the death screen
      this.lighting.update(this.player.camera, this.time, dt);
      updateWater(this.time);
    } else if (this.state === 'escaping') {
      this.time += dt;
      this.escape.update(dt);
      this.audio.setWindLevel(this.escape.windLevel);
      if (this.escape.finished) this.finishEscape();
    }

    if (this.state === 'escaping' || this.state === 'escaped') {
      this.escape.render(this.renderer);
      this.hud.tickFps(frameSeconds);
    } else if (this.state !== 'menu') {
      this.postfx.update(this.time, dt);
      this.postfx.render();
      this.hud.tickFps(frameSeconds);
    }
    this.input.endFrame();
  }

  private updatePlaying(dt: number): void {
    const p = this.player;
    const uiOpen = this.invUI.open || this.keypad.open;
    // between floors nothing is yours to drive: the fall takes the frame
    this.updateTransition(dt);
    const falling = this.fadeDir !== 0;

    // ---- toggles ----
    if (this.input.pressed('Escape') && !uiOpen && !this.swallowEscape) this.pauseGame();
    this.swallowEscape = false;
    if (this.input.pressed('Tab') || this.input.pressed('KeyI')) {
      const open = this.invUI.toggle();
      this.expectUnlock = open;
      this.touch.setBagOpen(open);
      if (open) this.input.exitPointerLock();
      else void this.input.requestPointerLock();
    }
    if (this.input.pressed('KeyF') && this.inventory.has('flashlight')) this.toggleTorch();
    if (this.input.pressed('KeyR') && !uiOpen && this.inventory.has('detector')) {
      this.receiverOnExit = !this.receiverOnExit;
      this.audio.playSfx('click', 0.45);
    }

    // ---- torch battery ----
    if (this.lighting.flashlightOn) {
      this.torchCharge -= TORCH_DRAIN * dt;
      if (this.torchCharge <= 0) {
        this.torchCharge = 0;
        this.lighting.setFlashlight(false);
        this.audio.playSfx('click', 0.5);
        this.flashMessage('TORCH DEAD — FIND A BATTERY');
      }
    }
    // secret: hug the monster standing next to you
    if (this.input.pressed('KeyH') && !uiOpen) this.tryHug();
    if (DEV_HACKS && !uiOpen) this.updateDevHacks();
    if (!uiOpen) this.updateQuickSelect();

    // ---- world streaming ----
    this.world.update(p.position.x, p.position.z);

    // ---- player & combat (frozen while an overlay is open, or mid-fall) ----
    if (!uiOpen && !falling) {
      p.canRun = this.stats.thirst > 0;
      p.update(dt, this.input, this.world);
      this.combat.update(dt, this.input, p, this.world, this.spawner.enemies);
    }
    this.telemetry.update(
      p.position.x,
      p.position.z,
      !uiOpen && !falling,
      p.moving,
      this.depth,
      this.survivalTime,
      this.inputMode(),
    );

    // ---- interactions ----
    // The way down speaks first. Everything else in reach — a battery on the
    // floor, a tap, a vending machine — waits until it has nothing to say, so
    // one press of E can never mean two things at once.
    const descentPrompt = falling ? null : this.updateDescent(dt, uiOpen);
    let prompt: string | null = descentPrompt;
    let drinkingTap = false;

    // the door out takes priority over anything else you could be touching
    const portal = this.portals.portal;
    const atPortal = !uiOpen && !!portal && portal.distanceTo(p.position) < 3.0;
    if (portal && atPortal) {
      const fuses = this.fuseCount();
      if (!portal.isOpen) {
        prompt = fuses > 0
          ? `E — FEED ${fuses} FUSE${fuses > 1 ? 'S' : ''} INTO THE DOOR`
          : 'DEAD DOOR — IT NEEDS FUSES';
        if (fuses > 0 && this.input.pressed('KeyE')) this.openPortal(fuses);
      } else {
        prompt = 'E — STEP THROUGH';
        if (this.input.pressed('KeyE')) this.beginEscape();
      }
    }

    const pickup = descentPrompt ? null : this.pickups.nearest(p.position, 2.1);
    if (pickup && !uiOpen && !atPortal) {
      // Batteries are never carried: grabbing one empties it into the torch
      // there and then. A full torch leaves it where it is, unspent.
      const isBattery = pickup.item.def.id === 'battery';
      const torchFull = this.torchCharge >= 99.5;
      if (isBattery) {
        prompt = torchFull ? 'BATTERY — TORCH IS ALREADY FULL' : `E — CHARGE THE TORCH (+${BATTERY_CHARGE}%)`;
      } else {
        prompt = `E — TAKE ${pickup.item.def.name}`;
      }
      if (this.input.pressed('KeyE') && !(isBattery && torchFull)) {
        if (isBattery) {
          this.pickups.take(pickup);
          this.torchCharge = Math.min(100, this.torchCharge + BATTERY_CHARGE);
          this.audio.playSfx('reload', 0.6);
          this.flashMessage(`BATTERY DRAINED INTO THE TORCH — ${Math.round(this.torchCharge)}%`);
        } else {
          const verdict = this.inventory.canAdd(pickup.item);
          if (verdict === 'ok') {
            this.inventory.add(this.pickups.take(pickup));
            this.audio.playSfx('pickup', 0.6);
          } else {
            this.flashMessage(`${verdict === 'weight' ? 'TOO HEAVY' : 'NO SPACE'} — TAB: BAG, DRAG AN ITEM OUT TO DROP`);
          }
        }
      }
    }

    // almond water machines: instant, but only a few servings each
    const vend = atPortal || descentPrompt ? null : this.nearestVending(1.9);
    if (vend && !pickup) {
      const left = this.vendingLeft.get(vend.id) ?? VENDING_SERVINGS;
      if (left > 0) {
        prompt = `E — ALMOND WATER (${left} LEFT)`;
        if (this.input.pressed('KeyE')) {
          this.vendingLeft.set(vend.id, left - 1);
          this.stats.thirst = 100;
          this.audio.playSfx('gulp', 0.6);
          this.flashMessage('ALMOND WATER — IT TASTES ALMOST LIKE ALMONDS');
        }
      } else {
        prompt = 'EMPTY';
      }
    }

    // taps: crouch nearby to drink, or top the bottle up standing
    const bottle = this.equippedBottle();
    const canFill = !!bottle && bottle.water < BOTTLE_CAPACITY;
    const tap = descentPrompt ? null : this.nearestTap(1.5);
    const atSource = !pickup && !vend && !atPortal && !descentPrompt && (!!tap || p.inWater);
    if (tap && !pickup && !vend && !atPortal) {
      if (p.crouching) {
        drinkingTap = true;
        prompt = canFill ? 'DRINKING…  ·  E — FILL THE BOTTLE' : 'DRINKING…';
        p.drinkDip += (1 - p.drinkDip) * Math.min(1, dt * 5);
        this.gulpTimer -= dt;
        if (this.gulpTimer <= 0) {
          this.gulpTimer = 0.75;
          this.audio.playSfx('gulp', 0.5);
        }
      } else {
        prompt = canFill ? 'E — FILL THE BOTTLE  ·  CROUCH (C) TO DRINK' : 'CROUCH (C) TO DRINK';
      }
    } else if (canFill && atSource) {
      prompt = 'E — FILL THE BOTTLE';
    }
    if (canFill && atSource && this.input.pressed('KeyE')) this.fillBottle(bottle!);

    // …and drink it back anywhere, holding right click
    let drinkingBottle = false;
    if (bottle && bottle.water > 0 && !uiOpen && this.input.mouseDown[2]) {
      if (this.stats.thirst < 100) {
        drinkingBottle = true;
        const sip = Math.min(bottle.water, BOTTLE_DRINK_RATE * dt);
        bottle.water -= sip;
        this.stats.thirst = Math.min(100, this.stats.thirst + sip);
        p.drinkDip += (1 - p.drinkDip) * Math.min(1, dt * 5);
        this.gulpTimer -= dt;
        if (this.gulpTimer <= 0) {
          this.gulpTimer = 0.7;
          this.audio.playSfx('gulp', 0.55);
        }
        if (bottle.water <= 0.01) {
          bottle.water = 0;
          this.flashMessage('BOTTLE EMPTY');
        }
        this.inventory.onChanged?.();
      } else {
        prompt = 'NOT THIRSTY';
      }
    }
    if (!drinkingTap && !drinkingBottle) p.drinkDip *= Math.max(0, 1 - dt * 6);

    // drop held item
    if (this.input.pressed('KeyG') && !uiOpen) {
      if (this.inventory.equipped) {
        this.dropItem(this.inventory.equipped);
      } else if (this.inventory.items.length > 0) {
        this.flashMessage('HOLD AN ITEM FIRST (1–9 / WHEEL), THEN G DROPS IT');
      }
    }

    // ---- survival ----
    const submerged = p.underwater || (p.inWater && p.swimming);
    this.stats.update(dt, p.running, drinkingTap, submerged, p.underwater);
    // the last few seconds of a breath are all you can hear
    if (this.stats.oxygen < 32 && p.underwater) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.heartTimer = 0.55 + (this.stats.oxygen / 100) * 1.2;
        this.audio.playSfx('heartbeat', 0.5 + (1 - this.stats.oxygen / 32) * 0.4, 0.02);
      }
    }
    if (submerged) {
      this.gulpTimer -= dt;
      if (this.gulpTimer <= 0 && this.stats.thirst < 99) {
        this.gulpTimer = 1.1;
        this.audio.playSfx('gulp', 0.3);
      }
    }

    // ---- enemies ----
    const ctx: EnemyContext = {
      world: this.world,
      player: p,
      lighting: this.lighting,
      time: this.time,
      isBlocking: () => this.combat.isBlocking(),
      damagePlayer: (amount, cause) => this.stats.applyDamage(amount, cause),
      notifySound: (e, intensity) => this.onEnemyCue(e, intensity),
    };
    this.spawner.update(dt, ctx);

    // ---- atmosphere ----
    const biome = this.world.biomeAt(p.position.x, p.position.z);
    this.fogTargetColor.setHex(biome.fogColor);
    this.fogColor.lerp(this.fogTargetColor, Math.min(1, dt * 1.2));
    this.fog.color.copy(this.fogColor);
    this.fog.density += (biome.fogDensity - this.fog.density) * Math.min(1, dt * 1.2);
    this.postfx.setVignette(biome.vignette);
    this.postfx.setWaterTint(biome.underwaterTint);
    this.hud.announceBiome(biome.name);
    this.audio.setAmbience(biome.ambienceId);

    // wading follows how fast you are dragging yourself through the water, and
    // keeps a floor under it while submerged so the water never goes silent
    if (p.inWater) {
      const speed = Math.hypot(p.velocity.x, p.velocity.z);
      this.audio.setWading(Math.max(p.swimming ? 0.12 : 0.06, Math.min(1, speed / RUN_SPEED)));
    } else {
      this.audio.stopWading();
    }

    // the torch dies as something gets close (full dark at touch range);
    // befriended companions no longer scare it
    let nearestEnemy = Infinity;
    let nearestSubject = Infinity;
    const fwd = this.viewDirection;
    p.camera.getWorldDirection(fwd);
    for (const e of this.spawner.enemies) {
      if (!e.alive) continue;
      const to = this.enemyOffset.subVectors(e.position, p.position);
      const d = to.length();
      if (!e.befriended) nearestEnemy = Math.min(nearestEnemy, d);
      // anything caught in the beam cone drives the flashlight's auto-iris
      if (d < 12 && to.normalize().dot(fwd) > 0.8) nearestSubject = Math.min(nearestSubject, d);
    }
    this.lighting.setThreat(1 - (nearestEnemy - 1) / 13);
    this.lighting.setSubjectDistance(nearestSubject);

    this.lighting.update(p.camera, this.time, dt);
    updateWater(this.time);
    this.pickups.update(this.time);
    this.portals.update(this.time, dt);
    this.descentMgr.update(
      { progress: this.descent.progress, open: this.descent.open, time: this.time, dt },
      this.descent.progress,
    );
    this.postfx.setUnderwater(p.underwater);
    this.audio.setMuffled(p.underwater);
    this.audio.update(dt);

    const danger = this.spawner.dangerLevel(p.position);
    this.music.setTension(danger);
    this.audio.setDread(danger);
    this.music.update();

    // ---- objective ----
    // How aware the floor is of what you are doing to it. On the last floor
    // that's fuses pulled; on the others it's how far through its own toll you
    // have got — and on Level 1 it is quite literally how much noise you are
    // making, which drops back down as the alarms give up.
    this.noiseHeat = Math.max(0, this.noiseHeat - dt / 40);
    this.spawner.setPressure(Math.min(1, this.noiseHeat + (this.depth === LAST_DEPTH
      ? this.takenFuses() / FUSE_COUNT
      : this.descent.open ? 1
        : descentKind(this.depth) === 'shutter'
          ? this.liveAlarms() / ALARMS_NEEDED
          : this.descent.progress * 0.6)));
    this.updateObjective(dt);
    this.depthTimer -= dt;
    if (this.depthTimer <= 0) {
      this.depthTimer = 2;
      noteDepth(Math.hypot(p.position.x - SPAWN_X, p.position.z - SPAWN_Z));
    }

    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = AUTOSAVE_EVERY;
      this.saveRun();
    }

    // ---- HUD ----
    this.hud.setBars(this.stats.health, this.stats.thirst);
    this.hud.setOxygen(this.stats.oxygen);
    this.hud.setTorch(this.inventory.has('flashlight') ? this.torchCharge : null);
    this.damageOverlay = Math.max(0, this.damageOverlay - dt * 1.4);
    this.hud.setDamageOverlay(this.damageOverlay * 0.8 + danger * 0.15);

    if (!prompt && this.stats.thirst <= 0 && this.input.down('ShiftLeft') && p.moving) {
      prompt = 'TOO THIRSTY TO RUN — FIND WATER';
    }

    this.messageTimer -= dt;
    if (this.messageTimer > 0) prompt = this.message;
    this.hud.setPrompt(uiOpen ? null : prompt);

    const eq = this.inventory.equipped;
    let detail = '';
    if (eq?.def.id === 'pistol') detail = `${eq.ammo} rds`;
    else if (eq?.def.id === 'bottle') {
      const sip = this.input.touchMode ? 'BLOCK' : 'RIGHT CLICK';
      // the fill hint belongs to the tap/pool prompt, not to a permanent label
      detail = eq.water > 0
        ? `WATER ${Math.round((eq.water / BOTTLE_CAPACITY) * 100)}% · HOLD ${sip} TO DRINK`
        : 'EMPTY';
    } else if (eq && isFinite(eq.def.durability)) detail = `${Math.max(0, Math.ceil((eq.durability / eq.def.durability) * 100))}%`;
    const torch = !this.inventory.has('flashlight') ? ''
      : this.torchCharge <= 1
        ? ' · TORCH DEAD'
        : this.lighting.flashlightOn ? ' · TORCH ON' : ' · TORCH [F]';
    this.hud.setEquipped((eq ? `${eq.def.name} · DROP [G]` : 'FISTS') + torch, detail);
    this.hud.setHotbar(this.inventory.items.slice(0, 10).map((p, i) => ({
      key: i === 9 ? '0' : String(i + 1),
      id: p.item.def.id,
      equipped: this.inventory.equipped === p.item,
    })));

  }

  // -------------------------------------------------------- the way down

  /** The prop this floor's exit is attached to, if its chunk is loaded. */
  private get descentProp() {
    return this.descentMgr.prop;
  }

  /** Where the receiver points on this floor. */
  private descentTarget(): THREE.Vector3 | null {
    const layout = descentLayout(this.seed, this.depth);
    const kind = descentKind(this.depth);
    // the unlock first, the way down second — you cannot use one without the other
    const needsSub = (kind === 'drain' && this.descent.progress < 1)
      || (kind === 'door' && !this.descent.codeKnown);
    if (needsSub && layout.sub) {
      return this.descentMgr.sub?.position.clone()
        ?? chunkCentre(layout.sub.cx, layout.sub.cz);
    }
    return this.descentProp?.target.clone() ?? chunkCentre(layout.exit.cx, layout.exit.cz);
  }

  private liveAlarms(): number {
    return this.alarms.size;
  }

  /** The nearest parked car, for hitting. */
  private nearestCar(maxDist: number): CarSpot | null {
    const p = this.player.position;
    let best: CarSpot | null = null;
    let bestD = maxDist * maxDist;
    for (const c of this.world.allChunks()) {
      for (const car of c.cars) {
        if (car.inverted) continue; // that one is on the ceiling, and it is not your problem
        const dx = car.x - p.x;
        const dz = car.z - p.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = car; }
      }
    }
    return best;
  }

  /**
   * The floor has agreed. Everything that was in the way gets out of it, once,
   * loudly — the noise is the point, because everything else down here heard it.
   */
  private openTheWayDown(): void {
    if (this.descent.open) return;
    this.descent.open = true;
    this.descentMgr.clearBlocker();
    switch (descentKind(this.depth)) {
      case 'shutter':
        this.audio.playSfx('shutter', 0.8, 0.02);
        this.flashMessage('THE RAMP IS OPEN. GO DOWN.');
        break;
      case 'door':
        this.audio.playSfx('clunk', 0.7);
        this.flashMessage('THE DOOR IS OPEN. THE STAIRS GO DOWN.');
        break;
      case 'hatch':
        this.audio.playSfx('clunk', 0.8);
        this.flashMessage('THE HATCH GIVES');
        break;
      case 'drain':
        this.audio.playSfx('valve', 0.6);
        this.flashMessage('THE GRATE HAS OPENED. IT WANTS YOU DOWN THERE.');
        break;
      default:
        break;
    }
    this.music.spike();
  }

  /**
   * Everything this floor asks of you, per frame. Returns the prompt it wants
   * on screen, or null if it has nothing to say from where you're standing.
   */
  private updateDescent(dt: number, uiOpen: boolean): string | null {
    if (this.depth >= LAST_DEPTH) return null;
    const p = this.player.position;
    const kind = descentKind(this.depth);
    const prop = this.descentProp;
    const holdE = !uiOpen && this.input.down('KeyE');
    let prompt: string | null = null;

    // ---- the sub-landmark: the wheel that floods a level, the wall that
    //      somebody wrote a door code on ----
    const sub = this.descentMgr.sub;
    if (sub) {
      const d = sub.position.distanceTo(p);
      if (sub.spot.kind === 'code' && d < 4.5 && !this.descent.codeKnown) {
        this.descent.codeKnown = true;
        this.audio.playSfx('click', 0.4);
        this.flashMessage(`${descentLayout(this.seed, this.depth).code} — DON'T WRITE IT DOWN`);
      }
      if (sub.spot.kind === 'valve' && d < 2.3 && this.descent.progress < 1) {
        prompt = 'HOLD E — THE MAIN VALVE';
        if (holdE) {
          this.descent.progress = Math.min(1, this.descent.progress + dt / VALVE_TURN);
          prompt = `TURNING…  ${Math.round(this.descent.progress * 100)}%`;
          if (this.valveGroan <= 0) {
            this.valveGroan = 0.9;
            this.audio.playSfx('valve', 0.4);
          }
          if (this.descent.progress >= 1) {
            this.audio.playSfx('flood', 0.75, 0.02);
            this.music.spike();
            this.flashMessage('IT IS COMING UP THROUGH THE FLOOR. FIND THE DEEP END.');
          }
        }
      }
    }
    this.valveGroan -= dt;

    // ---- Level 37 fills up, once, from wherever you happen to be standing ----
    if (kind === 'drain' && this.descent.progress >= 1 && this.descent.flood < FLOOD_HEIGHT) {
      this.descent.flood = Math.min(FLOOD_HEIGHT, this.descent.flood + FLOOD_RATE * dt);
      this.world.setWaterRise(this.descent.flood);
      if (this.descent.flood >= FLOOD_OPENS_DRAIN) this.openTheWayDown();
    }

    // ---- Level 1: the cars, and how loud you can make them ----
    if (kind === 'shutter') {
      for (const [id, left] of this.alarms) {
        if (left - dt <= 0) this.alarms.delete(id);
        else this.alarms.set(id, left - dt);
      }
      this.alarmChirp -= dt;
      if (this.alarms.size > 0 && this.alarmChirp <= 0) {
        this.alarmChirp = 2.4;
        for (const c of this.world.allChunks()) {
          for (const car of c.cars) {
            if (!this.alarms.has(car.id)) continue;
            this.audio.playSfxAt('carAlarm', new THREE.Vector3(car.x, 1.2, car.z), 0.55, 9);
          }
        }
      }
      if (!this.descent.open) {
        const car = this.nearestCar(2.9);
        if (car && !prompt) {
          const live = this.alarms.has(car.id);
          prompt = live
            ? `ALREADY SCREAMING · ${this.liveAlarms()}/${ALARMS_NEEDED}`
            : `E — SET THE ALARM OFF (${this.liveAlarms()}/${ALARMS_NEEDED})`;
          if (!live && !uiOpen && this.input.pressed('KeyE')) {
            this.alarms.set(car.id, ALARM_TIME);
            this.alarmChirp = 0;
            this.audio.playSfxAt('carAlarm', new THREE.Vector3(car.x, 1.2, car.z), 0.75, 9);
            if (this.liveAlarms() >= ALARMS_NEEDED) this.openTheWayDown();
            else this.flashMessage(`${this.liveAlarms()} OF ${ALARMS_NEEDED} · THEY DON'T SCREAM FOR LONG`);
          }
        }
      }
    }

    if (!prop) return prompt;
    const toProp = prop.target.distanceTo(p);

    // ---- the way down itself ----
    switch (kind) {
      case 'softwall': {
        if (toProp < 2.2 && !this.descent.open) {
          prompt = this.descent.progress > 0
            ? `PUSHING…  ${Math.round(this.descent.progress * 100)}%`
            : 'HOLD E — THE WALL IS SOFT HERE';
          if (holdE) {
            this.descent.progress = Math.min(1, this.descent.progress + dt / SOFTWALL_PUSH);
            if (this.descent.progress >= 1) {
              this.audio.playSfx('crumble', 0.85);
              this.openTheWayDown();
              this.beginDescend();
            }
          } else {
            // let go and the wall pushes back, slowly
            this.descent.progress = Math.max(0, this.descent.progress - dt * 0.35);
          }
        }
        break;
      }
      case 'shutter':
      case 'door': {
        if (this.descent.open && toProp < 2.4) this.beginDescend();
        else if (kind === 'door' && !this.descent.open && toProp < 3.2) {
          prompt = this.descent.codeKnown
            ? `E — KEYPAD (${descentLayout(this.seed, this.depth).code})`
            : 'E — KEYPAD · FOUR DIGITS YOU DO NOT HAVE';
          if (!uiOpen && !this.keypad.open && this.input.pressed('KeyE')) {
            this.keypad.show();
            this.expectUnlock = true;
            this.input.exitPointerLock();
            this.touch.setActive(false);
          }
        } else if (kind === 'shutter' && !this.descent.open && toProp < 6) {
          prompt = `THE SHUTTER IS DOWN · ${this.liveAlarms()}/${ALARMS_NEEDED} ALARMS`;
        }
        break;
      }
      case 'drain': {
        if (this.descent.open && toProp < 2.6 && this.player.underwater) this.beginDescend();
        else if (toProp < 3.2 && !this.descent.open) {
          prompt = this.descent.progress >= 1
            ? 'THE GRATE IS STILL SHUT — IT NEEDS MORE WATER'
            : 'A DRAIN, AND NOTHING TO PULL IT · FIND THE MAIN VALVE';
        }
        break;
      }
      case 'hatch': {
        if (this.descent.open) {
          if (toProp < 1.8) this.beginDescend();
          else if (toProp < 4) prompt = 'THE HATCH IS OPEN — SWIM DOWN INTO IT';
        } else if (toProp < 2.6) {
          if (!this.player.underwater) {
            prompt = 'THE HATCH IS DOWN THERE — YOU HAVE TO GO UNDER';
          } else {
            prompt = `HOLD E — THE WHEEL IS SEIZED  ${Math.round(this.descent.progress * 100)}%`;
            if (holdE) {
              this.descent.progress = Math.min(1, this.descent.progress + dt / HATCH_CRANK);
              if (this.valveGroan <= 0) {
                this.valveGroan = 1.1;
                this.audio.playSfx('valve', 0.35);
              }
              if (this.descent.progress >= 1) this.openTheWayDown();
            }
          }
        }
        break;
      }
      default:
        break;
    }
    return prompt;
  }

  /** Start the fall to the next floor: black out, then rebuild the world. */
  private beginDescend(): void {
    if (this.fadeDir !== 0 || this.depth >= LAST_DEPTH) return;
    this.pendingDepth = this.depth + 1;
    this.fadeDir = 1;
    this.keypad.hide();
    this.invUI.setOpen(false);
    this.audio.playSfx('whoosh', 0.7, 0.02);
    this.audio.stopWading();
  }

  /** The seconds of black, and the swap that happens in the middle of them. */
  private updateTransition(dt: number): void {
    if (this.fadeDir === 0) return;
    this.fade = Math.max(0, Math.min(1, this.fade + (this.fadeDir * dt) / FADE_TIME));
    this.hud.setFade(this.fade);
    if (this.fadeDir > 0 && this.fade >= 1) {
      this.enterLevel(this.pendingDepth);
      this.pendingDepth = -1;
      this.fadeDir = -1;
    } else if (this.fadeDir < 0 && this.fade <= 0) {
      this.fadeDir = 0;
    }
  }

  /**
   * Build the next floor under the player. The bag comes with you and so does
   * whatever is left of your health; nothing else does — the level you just
   * left is gone, and so is everything you put down in it.
   */
  private enterLevel(depth: number): void {
    this.depth = depth;
    const def = defForDepth(depth);
    this.descent = { ...EMPTY_DESCENT };
    this.alarms.clear();
    this.vendingLeft.clear();

    this.world.setDepth(depth);
    this.pickups.reset();
    this.spawner.reset();
    this.portals.reset();
    this.descentMgr.reset(descentLayout(this.seed, depth).code);
    this.escapeFuses = 0;
    this.portalOpened = false;

    this.world.preload(SPAWN_X, SPAWN_Z);
    this.player.reset(SPAWN_X, SPAWN_Z);
    // You arrive the way the last floor spat you out: on your feet, through
    // the ceiling, or head-first into water. Spawn just under the ceiling
    // rather than through it — the controller pushes you back down out of
    // solid roof, and that reads as a stumble, not a fall.
    if (def.arrival !== 'stand') {
      this.player.position.y = def.ceiling - PLAYER_HEIGHT - 0.06;
      // the torrent has been carrying you for a while before the level catches
      // you; the water bleeds it off over the first second or so of the dive
      this.player.velocity.y = def.arrival === 'plunge' ? -11 : -2;
    }
    this.stats.oxygen = 100;
    this.combat.reset();

    if (def.arrival === 'plunge') this.audio.playSfx('flood', 0.7, 0.02);
    if (def.arrival === 'drop') this.audio.playSfx('splash', 0.5);
    this.hud.showLevelCard(def.name, def.tagline);
    noteLevel(depth);
    this.telemetry.level(depth, this.survivalTime, this.inputMode());
    this.saveRun();
  }

  // ------------------------------------------------------ the objective

  /** Fuses currently in the bag — the only ones that count at the door. */
  private fuseCount(): number {
    return this.inventory.items.filter((p) => p.item.def.id === 'fuse').length;
  }

  /** Fuses pulled out of the world. Dropping one doesn't calm the floor down. */
  private takenFuses(): number {
    return objectiveLayout(this.seed).fuses
      .filter((f) => this.pickups.isConsumed(`fuse:${f.cx},${f.cz}`)).length;
  }

  /**
   * Feeds the tracker: which way the receiver is pointing and how far off the
   * target is. The bearing is relative to where the player is looking, so the
   * arrow reads like a compass needle rather than a map marker.
   */
  private updateObjective(dt: number): void {
    const hasReceiver = !!this.inventory.has('detector');
    const p = this.player.position;
    const last = this.depth === LAST_DEPTH;

    const layout = objectiveLayout(this.seed);
    const remaining = last
      ? layout.fuses.filter((f) => !this.pickups.isConsumed(`fuse:${f.cx},${f.cz}`))
      : [];
    const onExit = this.receiverOnExit || remaining.length === 0;
    const carried = this.fuseCount();

    let target: THREE.Vector3 | null = null;
    if (!last) {
      target = this.descentTarget();
    } else if (onExit) {
      target = this.portals.portal?.center.clone()
        ?? chunkCentre(layout.exit.cx, layout.exit.cz);
    } else {
      let best = Infinity;
      for (const f of remaining) {
        const c = chunkCentre(f.cx, f.cz);
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < best) { best = d; target = c; }
      }
    }

    let bearing: number | null = null;
    let distance: number | null = null;
    if (hasReceiver && target) {
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      distance = Math.hypot(dx, dz);
      const fwd = this.objectiveForward;
      this.player.camera.getWorldDirection(fwd);
      // right-hand vector of the view, flattened: (-fz, fx)
      bearing = Math.atan2(dx * -fwd.z + dz * fwd.x, dx * fwd.x + dz * fwd.z);

      // the receiver ticks faster the closer the target is
      this.pingTimer -= dt;
      if (this.pingTimer <= 0) {
        this.pingTimer = Math.max(0.32, Math.min(3.4, 0.3 + distance / 110));
        this.audio.playSfx('ping', 0.11, 0.02);
      }
    }

    const key = hasReceiver ? '  [R]' : '';
    let view: ObjectiveView;
    if (last) {
      const open = this.portals.portal?.isOpen ?? false;
      view = {
        title: open ? `THE DOOR IS OPEN${key}`
          : onExit ? (carried > 0 ? `GET TO THE DOOR${key}` : `THE DOOR IS DEAD${key}`)
            : `FIND THE FUSES${key}`,
        // once they're in the door they stay spent, not lost
        done: open ? this.escapeFuses : carried,
        total: FUSE_COUNT,
        bearing,
        distance,
        ready: open || (onExit && carried > 0),
      };
    } else {
      view = { ...this.floorObjective(), bearing, distance };
      view.title += key;
    }
    this.hud.setObjective(view);
  }

  /** What this floor wants, in five words, with pips for how far along you are. */
  private floorObjective(): ObjectiveView {
    const d = this.descent;
    const base = { bearing: null, distance: null } as const;
    switch (descentKind(this.depth)) {
      case 'softwall':
        return {
          ...base,
          title: d.open ? 'IT LET YOU THROUGH' : 'SOMEWHERE THE WALL IS SOFT',
          done: d.open ? 1 : 0, total: 1, ready: d.open,
        };
      case 'shutter':
        return {
          ...base,
          title: d.open ? 'DOWN THE SERVICE RAMP' : 'MAKE FOUR CARS SCREAM AT ONCE',
          done: d.open ? ALARMS_NEEDED : this.liveAlarms(),
          total: ALARMS_NEEDED,
          ready: d.open,
        };
      case 'drain':
        return {
          ...base,
          title: d.open ? 'THE DEEP END WANTS YOU'
            : d.progress >= 1 ? 'IT IS FILLING — GET TO THE DEEP END'
              : 'FIND THE MAIN VALVE',
          done: (d.progress >= 1 ? 1 : 0) + (d.open ? 1 : 0),
          total: 2,
          ready: d.open,
        };
      case 'hatch':
        return {
          ...base,
          title: d.open ? 'THE HATCH IS OPEN' : 'A HATCH, AND A WHEEL THAT WILL NOT TURN',
          done: d.open ? 1 : 0, total: 1, ready: d.open,
        };
      case 'door':
        return {
          ...base,
          title: d.open ? 'THE STAIRS GO DOWN'
            : d.codeKnown ? `THE DOOR TAKES ${descentLayout(this.seed, this.depth).code}`
              : 'FOUR DIGITS, WRITTEN DOWN SOMEWHERE',
          done: (d.codeKnown ? 1 : 0) + (d.open ? 1 : 0),
          total: 2,
          ready: d.open,
        };
      default:
        return { ...base, title: 'DOWN', done: 0, total: 1, ready: false };
    }
  }

  private openPortal(fuses: number): void {
    const portal = this.portals.portal;
    if (!portal) return;
    for (const placed of [...this.inventory.items]) {
      if (placed.item.def.id === 'fuse') this.inventory.remove(placed.item);
    }
    this.escapeFuses = fuses;
    this.portalOpened = true;
    portal.open();
    this.audio.playSfx('fuseIn', 0.8);
    this.audio.playSfx('portalOpen', 0.75, 0.02);
    this.music.spike();
    this.spawner.setPressure(1);
    this.flashMessage(fuses >= FUSE_COUNT
      ? 'THE DOOR IS AWAKE. GO.'
      : 'IT OPENS — NOT ALL THE WAY. GO ANYWAY.');
  }

  /** Step through: the maze stops rendering and the fall takes over. */
  private beginEscape(): void {
    this.state = 'escaping';
    clearSave(); // the run is over the moment you step through

    this.expectUnlock = true;
    this.input.exitPointerLock();
    this.touch.setActive(false);
    this.invUI.setOpen(false);
    this.hud.setPrompt(null);
    this.hud.show(false);
    this.portals.portal?.setPull(1);
    this.escape.start(this.seed);
    this.audio.playSfx('whoosh', 0.9, 0.02);
    this.audio.startWind();
    this.audio.duckWorld(1);
    this.music.fadeOut(2.5);
  }

  private finishEscape(): void {
    this.state = 'escaped';
    this.escape.stop();
    this.audio.stopWind();
    this.telemetry.record('escape', this.depth, this.survivalTime, this.inputMode());
    this.menus.showEscape(
      this.escapeFuses,
      this.survivalTime,
      noteEscape(this.escapeFuses, this.survivalTime),
    );
  }

  private inputMode(): 'keyboard' | 'touch' {
    return this.input.touchMode ? 'touch' : 'keyboard';
  }

  /** The bottle in your hand, if that's what you're holding. */
  private equippedBottle(): ItemInstance | null {
    const eq = this.inventory.equipped;
    return eq?.def.id === 'bottle' ? eq : null;
  }

  /** Bottles fill in one go — bending over a tap is the cost, not the wait. */
  private fillBottle(bottle: ItemInstance): void {
    bottle.water = BOTTLE_CAPACITY;
    this.inventory.onChanged?.();
    this.audio.playSfx('splash', 0.35);
    this.flashMessage('BOTTLE FULL — HOLD RIGHT CLICK TO DRINK');
  }

  /** F: switch the torch. A flat one needs a battery off the floor. */
  private toggleTorch(): void {
    if (this.torchCharge <= 1) {
      this.flashMessage('TORCH IS DEAD — FIND A BATTERY');
      this.lighting.setFlashlight(false);
      return;
    }
    this.lighting.setFlashlight(!this.lighting.flashlightOn);
    this.audio.playSfx('click', 0.5);
  }

  /** Easter egg: press H right next to a monster to hug it. It melts,
   *  becomes your friend for the rest of the run and follows you around. */
  private tryHug(): void {
    let best: Enemy | null = null;
    let bestDist = 2.6;
    for (const e of this.spawner.enemies) {
      if (!e.alive || e.befriended) continue;
      const d = e.position.distanceTo(this.player.position);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    if (!best) return;
    best.befriend();
    this.audio.playSfx('pickup', 0.7);
    this.hud.showFriendSpeech(best.typeName, 'Thanks for the hug. I just needed a little love. 🥺');
    this.hud.burstHearts();
  }

  /** Number keys equip directly (same key again = put away);
   *  the mouse wheel cycles items → empty hands → first item. */
  private updateQuickSelect(): void {
    const items = this.inventory.items;
    for (let i = 0; i < Math.min(10, items.length); i++) {
      const code = i === 9 ? 'Digit0' : `Digit${i + 1}`;
      if (this.input.pressed(code)) {
        this.inventory.equip(items[i].item);
        this.audio.playSfx('click', 0.35);
      }
    }
    const wheel = this.input.wheelDelta;
    if (wheel !== 0 && items.length > 0) {
      const cur = items.findIndex((p) => p.item === this.inventory.equipped);
      // one virtual slot past the last item = empty hands
      const slots = items.length + 1;
      const from = cur < 0 ? items.length : cur;
      const next = (from + (wheel > 0 ? 1 : -1) + slots) % slots;
      this.inventory.equip(next === items.length ? null : items[next].item);
      this.audio.playSfx('click', 0.3);
    }
  }

  private dropItem(item: ItemInstance): void {
    if (item.def.id === 'flashlight') this.lighting.setFlashlight(false);
    this.inventory.remove(item);
    this.pickups.drop(item, this.player.position);
    this.audio.playSfx('click', 0.4);
  }

  /**
   * Dev-only keys, compiled out of a production build with the rest of
   * `DEV_HACKS`. Nothing here is part of the game:
   *
   *   PageDown / PageUp   one floor down / up, skipping the descent puzzle
   *   Backslash           jump to this floor's way down
   *   Shift+Backslash     jump to the thing that unlocks it, if it has one
   *
   * The number keys are left alone on purpose — they belong to the
   * quick-select bar, and Ctrl+number belongs to the browser's tab strip.
   */
  private updateDevHacks(): void {
    let target = -1;
    if (this.input.pressed('PageDown')) target = this.depth + 1;
    if (this.input.pressed('PageUp')) target = this.depth - 1;
    if (target >= 0 && target <= LAST_DEPTH && target !== this.depth) {
      this.teleportToDepth(target);
      this.flashMessage(`DEV — ${defForDepth(target).name}`);
      return;
    }
    if (this.input.pressed('Backslash')) {
      const toSub = this.input.down('ShiftLeft') || this.input.down('ShiftRight');
      const ok = toSub ? this.teleportToSub() : this.teleportToDescent();
      this.flashMessage(ok
        ? `DEV — ${toSub ? 'THE UNLOCK' : 'THE WAY DOWN'}`
        : 'DEV — NOTHING TO JUMP TO');
    }
  }

  /** Dev/test helper: jump to the exit portal, optionally with fuses in hand. */
  teleportToExit(withFuses = FUSE_COUNT): boolean {
    // the portal only exists on the last floor, so go there first
    if (this.depth !== LAST_DEPTH) this.teleportToDepth(LAST_DEPTH);
    const e = objectiveLayout(this.seed).exit;
    const x = e.cx * CHUNK + CHUNK / 2;
    const z = e.cz * CHUNK + CHUNK / 2;
    this.world.preload(x, z);
    const portal = this.portals.portal;
    if (!portal) return false;
    for (let i = 0; i < withFuses; i++) this.inventory.add(makeItem('fuse'));
    // stand a couple of metres off, looking straight at it
    const c = portal.center;
    const wall = portal.spot.onWall;
    this.player.position.set(c.x + (wall ? 2.4 : 0), 0.05, c.z + (wall ? 0 : 2.2));
    this.player.yaw = wall ? Math.PI / 2 : 0;
    this.player.pitch = wall ? 0 : -0.55;
    return true;
  }

  /** Dev/test helper: jump to one of the three fuse rooms. */
  teleportToFuse(index = 0): boolean {
    if (this.depth !== LAST_DEPTH) this.teleportToDepth(LAST_DEPTH);
    const f = objectiveLayout(this.seed).fuses[index];
    if (!f) return false;
    const x = f.cx * CHUNK + CHUNK / 2;
    const z = f.cz * CHUNK + CHUNK / 2;
    this.world.preload(x, z);
    let plinth: { x: number; y: number; z: number } | null = null;
    for (const c of this.world.allChunks()) {
      if (c.cx === f.cx && c.cz === f.cz && c.pedestal) plinth = c.pedestal;
    }
    if (!plinth) return false;
    this.player.position.set(plinth.x, plinth.y + 0.05, plinth.z + 3.4);
    this.player.yaw = 0;
    this.player.pitch = -0.15;
    return true;
  }

  /** Dev/test helper: drop straight onto a floor, skipping the ones above it. */
  teleportToDepth(depth: number): boolean {
    if (depth < 0 || depth > LAST_DEPTH || this.state !== 'playing') return false;
    this.enterLevel(depth);
    this.fade = 0;
    this.fadeDir = 0;
    this.hud.setFade(0);
    return true;
  }

  /** Dev/test helper: jump to whatever this floor's way down happens to be. */
  teleportToDescent(): boolean {
    if (this.depth >= LAST_DEPTH) return false;
    const e = descentLayout(this.seed, this.depth).exit;
    this.world.preload(e.cx * CHUNK + CHUNK / 2, e.cz * CHUNK + CHUNK / 2);
    const prop = this.descentMgr.prop;
    if (!prop) return false;
    const t = prop.target;
    this.player.position.set(t.x, Math.max(t.y, 0.05), t.z + 2.4);
    this.player.pitch = -0.2;
    this.player.yaw = Math.PI;
    return true;
  }

  /** Dev/test helper: jump to the unlock this floor needs, if it has one. */
  teleportToSub(): boolean {
    const s = descentLayout(this.seed, this.depth).sub;
    if (!s) return false;
    this.world.preload(s.cx * CHUNK + CHUNK / 2, s.cz * CHUNK + CHUNK / 2);
    const sub = this.descentMgr.sub;
    if (!sub) return false;
    this.player.position.set(sub.position.x + 1.6, 0.05, sub.position.z);
    this.player.yaw = Math.PI / 2;
    this.player.pitch = 0;
    return true;
  }

  /** Dev/test helper: which floor is under our feet, by name. */
  currentDepth(): { depth: number; name: string } {
    return { depth: this.depth, name: defForDepth(this.depth).name };
  }

  private nearestVending(maxDist: number): { id: string } | null {
    const p = this.player.position;
    for (const c of this.world.allChunks()) {
      for (const v of c.vending) {
        const dx = v.x - p.x;
        const dz = v.z - p.z;
        if (dx * dx + dz * dz < maxDist * maxDist && Math.abs(v.y - p.y) < 1.6) return v;
      }
    }
    return null;
  }

  private nearestTap(maxDist: number): { x: number; z: number } | null {
    const p = this.player.position;
    for (const c of this.world.allChunks()) {
      for (const t of c.taps) {
        const dx = t.x - p.x;
        const dz = t.z - p.z;
        if (dx * dx + dz * dz < maxDist * maxDist && Math.abs(t.y - p.y - 0.95) < 1.2) {
          return t;
        }
      }
    }
    return null;
  }
}
