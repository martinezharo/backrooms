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
import { BiomeId, biomeForChunk } from '../world/Biomes';
import { FUSE_COUNT, objectiveLayout } from '../world/Objective';
import { PortalManager } from '../world/Portal';
import { World } from '../world/World';
import { CHUNK } from './constants';
import { HUD, ObjectiveView } from '../ui/HUD';
import { InventoryUI } from '../ui/InventoryUI';
import { Menus } from '../ui/Menus';
import { TouchControls } from '../ui/TouchControls';
import { Input } from './Input';
import { loadRecords, noteDepth, noteEscape, noteRunStarted } from './Records';
import { getRenderQuality } from '../rendering/Quality';

type GameState = 'menu' | 'playing' | 'paused' | 'dead' | 'escaping' | 'escaped';

const SPAWN_X = 17;
const SPAWN_Z = 17;

/** torch runs ~5 minutes on one battery */
const TORCH_DRAIN = 100 / 300;
/** servings in one almond water machine */
const VENDING_SERVINGS = 3;

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
  private fogColor = new THREE.Color(0x2c2715);
  private fogTargetColor = new THREE.Color(0x2c2715);
  private fog: THREE.FogExp2;
  private message = '';
  private messageTimer = 0;

  // ---- the way out ----
  private portals: PortalManager;
  private escape = new Escape();
  private escapeFuses = 0;
  private torchCharge = 100;
  private vendingLeft = new Map<string, number>();
  private receiverOnExit = false;
  private pingTimer = 0;
  private depthTimer = 0;
  private readonly viewDirection = new THREE.Vector3();
  private readonly enemyOffset = new THREE.Vector3();

  constructor(seed: number) {
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
    this.renderer.toneMappingExposure = 1.05;

    this.fog = new THREE.FogExp2(this.fogColor.getHex(), 0.05);
    this.scene.fog = this.fog;
    this.scene.background = this.fogColor;

    this.input = new Input(canvas);
    this.touch = new TouchControls(this.input);
    this.player = new Player(window.innerWidth / window.innerHeight);
    this.player.camera.add(this.audio.listener);

    this.world = new World(seed, this.scene);
    this.pickups = new Pickups(this.scene, this.world);
    this.portals = new PortalManager(this.scene, this.world, seed);
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

    this.menus.showRecords(loadRecords());
    this.menus.showStart();
    requestAnimationFrame(() => this.loop());
  }

  /** Called by the small landing-page bootstrap after the game chunk loads. */
  public async start(): Promise<void> {
    await this.startGame();
  }

  // ------------------------------------------------------------ wiring

  private wireEvents(): void {
    this.menus.onStart = () => this.startGame();
    this.menus.onResume = () => this.resume();
    this.menus.onRestart = () => {
      const url = new URL(location.href);
      url.searchParams.set('seed', String(this.seed));
      location.href = url.toString();
    };
    this.menus.onNewSeed = () => {
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
      this.expectUnlock = true;
      this.input.exitPointerLock();
      this.touch.setActive(false);
      this.invUI.setOpen(false);
      this.hud.setPrompt(null);
      this.menus.showGameOver(cause, this.survivalTime, this.fuseCount());
    };

    this.combat.onSound = (s: CombatSound) => {
      if (s === 'spray') this.audio.startSprayLoop();
      else if (s === 'sprayStop') this.audio.stopSprayLoop();
      else this.audio.playSfx(s, s === 'gunshot' ? 0.9 : 0.6);
    };
    this.combat.onMessage = (m) => this.flashMessage(m);

    this.player.onFootstep = (s) => this.audio.footstep(s);
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

  private async startGame(): Promise<void> {
    this.menus.hideAll();
    await this.audio.resume();
    this.music.start();

    // Build the whole visible radius up front. Streaming it in afterwards only
    // moves the cost into the first seconds of play, where it shows up as
    // stutter and geometry popping in inside the view distance.
    this.world.preload(SPAWN_X, SPAWN_Z);
    this.player.reset(SPAWN_X, SPAWN_Z);
    this.stats.reset();
    this.survivalTime = 0;
    this.torchCharge = 100;
    this.vendingLeft.clear();
    this.receiverOnExit = false;
    noteRunStarted();

    this.hud.show(true);
    this.state = 'playing';
    this.audio.prepareWhenIdle();
    this.touch.goImmersive();
    this.touch.setBagOpen(false);
    this.touch.setActive(true);
    void this.input.requestPointerLock();
  }

  private pauseGame(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.touch.setActive(false);
    this.menus.showPause(true);
    void this.audio.suspend();
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
      this.lighting.update(this.player.camera, this.time);
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
    const uiOpen = this.invUI.open;

    // ---- toggles ----
    if (this.input.pressed('Escape') && !uiOpen) this.pauseGame();
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
        // never spend a battery for you — but say plainly how to spend it
        this.flashMessage(this.inventory.has('battery')
          ? 'TORCH DEAD — PRESS F TO FIT A BATTERY'
          : 'TORCH DEAD — FIND A BATTERY');
      }
    }
    // secret: hug the monster standing next to you
    if (this.input.pressed('KeyH') && !uiOpen) this.tryHug();
    if (!uiOpen) this.updateQuickSelect();

    // ---- world streaming ----
    this.world.update(p.position.x, p.position.z);

    // ---- player & combat (frozen while the inventory overlay is open) ----
    if (!uiOpen) {
      p.canRun = this.stats.thirst > 0;
      p.update(dt, this.input, this.world);
      this.combat.update(dt, this.input, p, this.world, this.spawner.enemies);
    }

    // ---- interactions ----
    let prompt: string | null = null;
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

    const pickup = this.pickups.nearest(p.position, 2.1);
    if (pickup && !uiOpen && !atPortal) {
      prompt = `E — TAKE ${pickup.item.def.name}`;
      if (this.input.pressed('KeyE')) {
        const verdict = this.inventory.canAdd(pickup.item);
        if (verdict === 'ok') {
          const taken = this.pickups.take(pickup);
          this.inventory.add(taken);
          this.audio.playSfx('pickup', 0.6);
          // a battery picked up with a dead torch goes straight in — that is
          // the only reason you bent down for it
          if (taken.def.id === 'battery' && this.torchCharge <= 1 && this.fitBattery()) {
            this.flashMessage('BATTERY IN — TORCH READY  [F]');
          }
        } else {
          this.flashMessage(`${verdict === 'weight' ? 'TOO HEAVY' : 'NO SPACE'} — TAB: BAG, DRAG AN ITEM OUT TO DROP`);
        }
      }
    }

    // almond water machines: instant, but only a few servings each
    const vend = atPortal ? null : this.nearestVending(1.9);
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

    // taps: crouch nearby to drink
    const tap = this.nearestTap(1.5);
    if (tap && !pickup && !vend && !atPortal) {
      if (p.crouching) {
        drinkingTap = true;
        prompt = 'DRINKING…';
        p.drinkDip += (1 - p.drinkDip) * Math.min(1, dt * 5);
        this.gulpTimer -= dt;
        if (this.gulpTimer <= 0) {
          this.gulpTimer = 0.75;
          this.audio.playSfx('gulp', 0.5);
        }
      } else {
        prompt = 'CROUCH (C) TO DRINK';
      }
    }
    if (!drinkingTap) p.drinkDip *= Math.max(0, 1 - dt * 6);

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
    this.stats.update(dt, p.running, drinkingTap, submerged);
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
    this.hud.announceBiome(biome.name);
    this.audio.setAmbience(biome.ambienceId);

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

    this.lighting.update(p.camera, this.time);
    updateWater(this.time);
    this.pickups.update(this.time);
    this.portals.update(this.time, dt);
    this.postfx.setUnderwater(p.underwater);
    this.audio.setMuffled(p.underwater);
    this.audio.update(dt);

    const danger = this.spawner.dangerLevel(p.position);
    this.music.setTension(danger);
    this.music.update();

    // ---- objective ----
    this.spawner.setPressure(this.takenFuses() / FUSE_COUNT);
    this.updateObjective(dt);
    this.depthTimer -= dt;
    if (this.depthTimer <= 0) {
      this.depthTimer = 2;
      noteDepth(Math.hypot(p.position.x - SPAWN_X, p.position.z - SPAWN_Z));
    }

    // ---- HUD ----
    this.hud.setBars(this.stats.health, this.stats.thirst);
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
    else if (eq && isFinite(eq.def.durability)) detail = `${Math.max(0, Math.ceil((eq.durability / eq.def.durability) * 100))}%`;
    const torch = !this.inventory.has('flashlight') ? ''
      : this.torchCharge <= 1
        ? (this.inventory.has('battery') ? ' · TORCH DEAD — [F] BATTERY' : ' · TORCH DEAD')
        : this.lighting.flashlightOn ? ' · TORCH ON' : ' · TORCH [F]';
    this.hud.setEquipped((eq ? `${eq.def.name} · DROP [G]` : 'FISTS') + torch, detail);
    this.hud.setHotbar(this.inventory.items.slice(0, 10).map((p, i) => ({
      key: i === 9 ? '0' : String(i + 1),
      id: p.item.def.id,
      equipped: this.inventory.equipped === p.item,
    })));

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

  private chunkCentre(cx: number, cz: number): THREE.Vector3 {
    return new THREE.Vector3(cx * CHUNK + CHUNK / 2, 0, cz * CHUNK + CHUNK / 2);
  }

  /**
   * Feeds the tracker: which way the receiver is pointing and how far off the
   * target is. The bearing is relative to where the player is looking, so the
   * arrow reads like a compass needle rather than a map marker.
   */
  private updateObjective(dt: number): void {
    const layout = objectiveLayout(this.seed);
    const remaining = layout.fuses.filter((f) => !this.pickups.isConsumed(`fuse:${f.cx},${f.cz}`));
    const onExit = this.receiverOnExit || remaining.length === 0;
    const hasReceiver = !!this.inventory.has('detector');
    const carried = this.fuseCount();
    const p = this.player.position;

    let target: THREE.Vector3 | null = null;
    if (onExit) {
      target = this.portals.portal?.center.clone()
        ?? this.chunkCentre(layout.exit.cx, layout.exit.cz);
    } else {
      let best = Infinity;
      for (const f of remaining) {
        const c = this.chunkCentre(f.cx, f.cz);
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
      const fwd = new THREE.Vector3();
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
    const open = this.portals.portal?.isOpen ?? false;
    const title = open ? `THE DOOR IS OPEN${key}`
      : onExit ? (carried > 0 ? `GET TO THE DOOR${key}` : `THE DOOR IS DEAD${key}`)
        : `FIND THE FUSES${key}`;

    const view: ObjectiveView = {
      title,
      // once they're in the door they stay spent, not lost
      fuses: open ? this.escapeFuses : carried,
      total: FUSE_COUNT,
      bearing,
      distance,
      ready: open || (onExit && carried > 0),
    };
    this.hud.setObjective(view);
  }

  private openPortal(fuses: number): void {
    const portal = this.portals.portal;
    if (!portal) return;
    for (const placed of [...this.inventory.items]) {
      if (placed.item.def.id === 'fuse') this.inventory.remove(placed.item);
    }
    this.escapeFuses = fuses;
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
    this.menus.showEscape(
      this.escapeFuses,
      this.survivalTime,
      noteEscape(this.escapeFuses, this.survivalTime),
    );
  }

  /** Spend one battery on the torch. False when there's nothing to spend. */
  private fitBattery(): boolean {
    const battery = this.inventory.has('battery');
    if (!battery || !this.inventory.has('flashlight')) return false;
    this.inventory.remove(battery);
    this.torchCharge = 100;
    this.audio.playSfx('reload', 0.6);
    return true;
  }

  /** F: a flat torch takes a battery, otherwise it just switches. */
  private toggleTorch(): void {
    if (this.torchCharge <= 1) {
      if (!this.fitBattery()) {
        this.flashMessage('TORCH IS DEAD — NO BATTERY');
        this.lighting.setFlashlight(false);
        return;
      }
      this.lighting.setFlashlight(true);
      this.flashMessage('BATTERY IN');
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

  /** Dev/test helper: jump to the exit portal, optionally with fuses in hand. */
  teleportToExit(withFuses = FUSE_COUNT): boolean {
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

  /** Dev/test helper: jump to the nearest chunk of a given biome. */
  teleportToBiome(id: BiomeId): boolean {
    const pcx = Math.floor(this.player.position.x / CHUNK);
    const pcz = Math.floor(this.player.position.z / CHUNK);
    for (let r = 1; r < 80; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = pcx + dx;
          const cz = pcz + dz;
          if (biomeForChunk(this.world.seed, cx, cz) !== id) continue;
          const x = cx * CHUNK + CHUNK / 2;
          const z = cz * CHUNK + CHUNK / 2;
          this.world.preload(x, z);
          const spot = this.world.findSpawnSpot(x, z, 0, 12, Math.random);
          this.player.position.set(spot?.x ?? x, (spot?.y ?? 0) + 0.05, spot?.z ?? z);
          this.player.pitch = 0;
          return true;
        }
      }
    }
    return false;
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
