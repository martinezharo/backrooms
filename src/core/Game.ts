// Game orchestrator: owns every system, the state machine and the main loop.

import * as THREE from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { Music } from '../audio/Music';
import { Enemy, EnemyContext } from '../enemies/Enemy';
import { Spawner } from '../enemies/Spawner';
import { Inventory } from '../items/Inventory';
import { ItemInstance } from '../items/Items';
import { Pickups } from '../items/Pickups';
import { Combat, CombatSound } from '../player/Combat';
import { Player } from '../player/Player';
import { Stats } from '../player/Stats';
import { Lighting } from '../rendering/Lighting';
import { PostFX } from '../rendering/PostFX';
import { updateWater } from '../rendering/Water';
import { BiomeId, biomeForChunk } from '../world/Biomes';
import { World } from '../world/World';
import { CHUNK } from './constants';
import { HUD } from '../ui/HUD';
import { InventoryUI } from '../ui/InventoryUI';
import { Menus } from '../ui/Menus';
import { Input } from './Input';

type GameState = 'menu' | 'playing' | 'paused' | 'dead';

const SPAWN_X = 17;
const SPAWN_Z = 17;

export class Game {
  private state: GameState = 'menu';
  private renderer: THREE.WebGLRenderer;
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

  constructor(seed: number) {
    this.seed = seed;
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.fog = new THREE.FogExp2(this.fogColor.getHex(), 0.05);
    this.scene.fog = this.fog;
    this.scene.background = this.fogColor;

    this.input = new Input(canvas);
    this.player = new Player(window.innerWidth / window.innerHeight);
    this.player.camera.add(this.audio.listener);

    this.world = new World(seed, this.scene);
    this.pickups = new Pickups(this.scene, this.world);
    this.lighting = new Lighting(this.scene, this.world);
    this.combat = new Combat(this.scene, this.player, this.inventory);
    this.spawner = new Spawner(this.scene, this.world);
    this.postfx = new PostFX(this.renderer, this.scene, this.player.camera);
    this.music = new Music(this.audio);
    this.invUI = new InventoryUI(this.inventory);

    this.wireEvents();

    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setSize(w, h);
      this.postfx.setSize(w, h);
      this.player.camera.aspect = w / h;
      this.player.camera.updateProjectionMatrix();
    });

    this.menus.showStart();
    requestAnimationFrame(() => this.loop());
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
      this.invUI.setOpen(false);
      this.hud.setPrompt(null);
      this.menus.showGameOver(cause, this.survivalTime);
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

    this.world.preload(SPAWN_X, SPAWN_Z);
    this.player.reset(SPAWN_X, SPAWN_Z);
    this.stats.reset();
    this.survivalTime = 0;

    this.hud.show(true);
    this.state = 'playing';
    void this.input.requestPointerLock();
  }

  private pauseGame(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.menus.showPause(true);
    void this.audio.suspend();
  }

  private async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    this.menus.showPause(false);
    await this.audio.resume();
    this.state = 'playing';
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
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
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
    }

    if (this.state !== 'menu') {
      this.postfx.update(this.time, dt);
      this.postfx.render();
      this.hud.tickFps(dt);
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
      if (open) this.input.exitPointerLock();
      else void this.input.requestPointerLock();
    }
    if (this.input.pressed('KeyF') && this.inventory.has('flashlight')) {
      this.lighting.setFlashlight(!this.lighting.flashlightOn);
      this.audio.playSfx('click', 0.5);
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

    const pickup = this.pickups.nearest(p.position, 2.1);
    if (pickup && !uiOpen) {
      prompt = `E — TAKE ${pickup.item.def.name}`;
      if (this.input.pressed('KeyE')) {
        const verdict = this.inventory.canAdd(pickup.item);
        if (verdict === 'ok') {
          this.inventory.add(this.pickups.take(pickup));
          this.audio.playSfx('pickup', 0.6);
        } else {
          this.flashMessage(`${verdict === 'weight' ? 'TOO HEAVY' : 'NO SPACE'} — TAB: BAG, DRAG AN ITEM OUT TO DROP`);
        }
      }
    }

    // taps: crouch nearby to drink
    const tap = this.nearestTap(1.5);
    if (tap && !pickup) {
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
    for (const e of this.spawner.enemies) {
      if (e.alive && !e.befriended) nearestEnemy = Math.min(nearestEnemy, e.position.distanceTo(p.position));
    }
    this.lighting.setThreat(1 - (nearestEnemy - 1) / 13);

    this.lighting.update(p.camera, this.time);
    updateWater(this.time);
    this.pickups.update(this.time);
    this.postfx.setUnderwater(p.underwater);
    this.audio.setMuffled(p.underwater);
    this.audio.update(dt);

    const danger = this.spawner.dangerLevel(p.position);
    this.music.setTension(danger);
    this.music.update();

    // ---- HUD ----
    this.hud.setBars(this.stats.health, this.stats.thirst);
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
    const torch = this.inventory.has('flashlight') ? (this.lighting.flashlightOn ? ' · TORCH ON' : ' · TORCH [F]') : '';
    this.hud.setEquipped((eq ? `${eq.def.name} · DROP [G]` : 'FISTS') + torch, detail);
    this.hud.setHotbar(this.inventory.items.slice(0, 10).map((p, i) => ({
      key: i === 9 ? '0' : String(i + 1),
      id: p.item.def.id,
      equipped: this.inventory.equipped === p.item,
    })));

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
