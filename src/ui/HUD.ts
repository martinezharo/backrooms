// DOM-based HUD: survival bars, prompts, equipped label, FPS, biome banner.

import { itemIcon } from './icons';

export class HUD {
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
  private friendSpeechTimer: number | null = null;
  private hotbarSig = '';

  private biomeShown = '';
  private biomeTimer: number | null = null;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fpsTime = 0;

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  setBars(health: number, thirst: number): void {
    (this.healthFill as HTMLElement).style.width = `${Math.max(0, health)}%`;
    (this.thirstFill as HTMLElement).style.width = `${Math.max(0, thirst)}%`;
    this.healthFill.classList.toggle('critical', health < 25);
    this.thirstFill.classList.toggle('critical', thirst < 20);
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
    for (const s of slots) {
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

  tickFps(dt: number): void {
    this.fpsAcc += dt;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime > 0.5) {
      const fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fps.textContent = `${fps} FPS`;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }
}
