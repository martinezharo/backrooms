// DOM-based HUD: survival bars, prompts, equipped label, FPS, biome banner.

import { itemIcon } from './icons';

export interface ObjectiveView {
  title: string;
  fuses: number;
  total: number;
  /** angle to the target relative to where you're looking, or null with no receiver */
  bearing: number | null;
  distance: number | null;
  ready: boolean;
}

export class HUD {
  /** tapping a hotbar slot equips it — the touch stand-in for the number keys */
  onSlotTap: ((index: number) => void) | null = null;

  private root = document.getElementById('hud')!;
  private healthFill = document.getElementById('health-fill')!;
  private thirstFill = document.getElementById('thirst-fill')!;
  private prompt = document.getElementById('interact-prompt')!;
  private equipped = document.getElementById('equipped-label')!;
  private fps = document.getElementById('fps-counter')!;
  private biome = document.getElementById('biome-label')!;
  private damageVignette = document.getElementById('damage-vignette')!;
  private hotbar = document.getElementById('hotbar')!;
  private friendSpeech = document.getElementById('friend-speech')!;
  private heartBurst = document.getElementById('heart-burst')!;
  private objective = document.getElementById('objective')!;
  private objTitle = document.getElementById('objective-title')!;
  private objPips = document.getElementById('objective-pips')!;
  private objArrow = document.getElementById('objective-arrow')!;
  private objDist = document.getElementById('objective-dist')!;
  private torchRow = document.getElementById('torch-row')!;
  private torchFill = document.getElementById('torch-fill')!;
  private friendSpeechTimer: number | null = null;
  private hotbarSig = '';
  private pipCount = -1;

  private biomeShown = '';
  private biomeTimer: number | null = null;
  private fpsFrames = 0;
  private fpsElapsed = 0;

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  setBars(health: number, thirst: number): void {
    (this.healthFill as HTMLElement).style.width = `${Math.max(0, health)}%`;
    (this.thirstFill as HTMLElement).style.width = `${Math.max(0, thirst)}%`;
    this.healthFill.classList.toggle('critical', health < 25);
    this.thirstFill.classList.toggle('critical', thirst < 20);
  }

  /** The run objective: fuse pips, plus a bearing arrow while you carry the receiver. */
  setObjective(o: ObjectiveView | null): void {
    if (!o) {
      this.objective.classList.add('hidden');
      return;
    }
    this.objective.classList.remove('hidden');
    this.objective.classList.toggle('ready', o.ready);
    this.objective.classList.toggle('no-signal', o.bearing === null);
    if (this.objTitle.textContent !== o.title) this.objTitle.textContent = o.title;

    if (this.pipCount !== o.total) {
      this.pipCount = o.total;
      this.objPips.innerHTML = '';
      for (let i = 0; i < o.total; i++) {
        const pip = document.createElement('span');
        pip.className = 'obj-pip';
        this.objPips.appendChild(pip);
      }
    }
    for (let i = 0; i < this.objPips.children.length; i++) {
      this.objPips.children[i].classList.toggle('filled', i < o.fuses);
    }

    if (o.bearing !== null) {
      (this.objArrow as HTMLElement).style.transform = `rotate(${(o.bearing * 180) / Math.PI}deg)`;
    }
    this.objDist.textContent = o.bearing === null
      ? 'NO RECEIVER'
      : o.distance === null ? 'SIGNAL LOST' : `${Math.round(o.distance / 10) * 10} M`;
  }

  /** Torch charge bar; hidden entirely when you have no torch. */
  setTorch(charge: number | null): void {
    this.torchRow.classList.toggle('hidden', charge === null);
    if (charge === null) return;
    (this.torchFill as HTMLElement).style.width = `${Math.max(0, charge)}%`;
    this.torchFill.classList.toggle('critical', charge < 20);
  }

  setPrompt(text: string | null): void {
    if (text) {
      this.prompt.textContent = text;
      this.prompt.classList.remove('hidden');
    } else {
      this.prompt.classList.add('hidden');
    }
  }

  setEquipped(name: string | null, detail = ''): void {
    this.equipped.innerHTML = name
      ? `${name}${detail ? `<br><span style="opacity:.6">${detail}</span>` : ''}`
      : '';
  }

  /** Always-visible quick bar; only rebuilds the DOM when contents change. */
  setHotbar(slots: { key: string; id: string; equipped: boolean }[]): void {
    const sig = slots.map((s) => `${s.key}${s.id}${s.equipped ? '*' : ''}`).join('|');
    if (sig === this.hotbarSig) return;
    this.hotbarSig = sig;
    this.hotbar.innerHTML = '';
    for (const [i, s] of slots.entries()) {
      const el = document.createElement('div');
      el.className = 'hotbar-slot' + (s.equipped ? ' equipped' : '');
      const key = document.createElement('span');
      key.className = 'hotbar-key';
      key.textContent = s.key;
      const icon = document.createElement('span');
      icon.className = 'hotbar-icon';
      icon.innerHTML = itemIcon(s.id);
      el.append(key, icon);
      if (s.equipped) {
        const drop = document.createElement('span');
        drop.className = 'hotbar-drop';
        drop.textContent = 'G⇣';
        el.appendChild(drop);
      }
      // only reachable with touch controls on: the bar ignores the mouse
      el.addEventListener('click', () => this.onSlotTap?.(i));
      this.hotbar.appendChild(el);
    }
  }

  /** Easter egg: the freshly hugged monster gets a word in. */
  showFriendSpeech(name: string, text: string): void {
    this.friendSpeech.textContent = '';
    const who = document.createElement('span');
    who.className = 'friend-name';
    who.textContent = name;
    this.friendSpeech.append(who, `“${text}”`);
    this.friendSpeech.classList.add('visible');
    if (this.friendSpeechTimer !== null) clearTimeout(this.friendSpeechTimer);
    this.friendSpeechTimer = window.setTimeout(
      () => this.friendSpeech.classList.remove('visible'), 5000);
  }

  /** Easter egg: a screenful of cute hearts floating up. */
  burstHearts(): void {
    const emojis = ['💖', '💕', '💗', '💓', '❤️', '💘', '💞'];
    for (let i = 0; i < 28; i++) {
      const h = document.createElement('span');
      h.className = 'burst-heart';
      h.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      h.style.left = `${Math.random() * 96}%`;
      h.style.fontSize = `${16 + Math.random() * 26}px`;
      h.style.animationDuration = `${2.2 + Math.random() * 2}s`;
      h.style.animationDelay = `${Math.random() * 0.9}s`;
      h.addEventListener('animationend', () => h.remove());
      this.heartBurst.appendChild(h);
    }
  }

  setDamageOverlay(strength: number): void {
    (this.damageVignette as HTMLElement).style.opacity = String(Math.min(1, strength));
  }

  announceBiome(name: string): void {
    if (this.biomeShown === name) return;
    this.biomeShown = name;
    this.biome.textContent = name;
    this.biome.classList.add('visible');
    if (this.biomeTimer !== null) clearTimeout(this.biomeTimer);
    this.biomeTimer = window.setTimeout(() => this.biome.classList.remove('visible'), 4500);
  }

  /**
   * Averaged over half a second of wall clock — feed it the real frame time,
   * not the simulation's clamped dt, or this only ever reports 1/clamp.
   */
  tickFps(frameSeconds: number): void {
    // a backgrounded tab produces one enormous frame; it says nothing about
    // how fast the game runs, so throw the whole window away
    if (frameSeconds > 1) {
      this.fpsFrames = 0;
      this.fpsElapsed = 0;
      return;
    }
    this.fpsFrames++;
    this.fpsElapsed += frameSeconds;
    if (this.fpsElapsed < 0.5) return;
    this.fps.textContent = `${Math.round(this.fpsFrames / this.fpsElapsed)} FPS`;
    this.fpsFrames = 0;
    this.fpsElapsed = 0;
  }
}
