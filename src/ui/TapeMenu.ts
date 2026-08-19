// TAPE 1's landing deck: the selected function controls the footage behind it.

interface Segment {
  timecode: string;
  level: string;
  position: number;
}

const SEGMENTS: Segment[] = [
  { timecode: '00:00:00', level: 'Level 0', position: 0 },
  { timecode: '00:03:41', level: 'Level 1', position: 18.9 },
  { timecode: '00:07:02', level: 'Level 37', position: 36.2 },
  { timecode: '00:10:55', level: 'Level 7', position: 56.1 },
  { timecode: '00:14:20', level: 'Level 2', position: 73.7 },
  { timecode: '00:17:48', level: 'Level !', position: 91.5 },
];

const MAX_SEED = 0xffffffff;

function parseSeed(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_SEED ? value : null;
}

function updateClock(clock: HTMLElement, openedAt: number): void {
  const elapsed = Math.max(0, Date.now() - openedAt);
  const seconds = Math.floor(elapsed / 1000);
  const frames = Math.floor((elapsed % 1000) / 40);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  clock.textContent = `00:${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function setupTapeMenu(seed: number): void {
  const landing = document.getElementById('start-screen');
  if (!landing || !landing.classList.contains('tape-landing')) return;

  const shots = [...landing.querySelectorAll<HTMLImageElement>('.tube-shot[data-seg]')];
  const bleeds = [...landing.querySelectorAll<HTMLImageElement>('.bleed-r, .bleed-b')];
  const marks = [...landing.querySelectorAll<HTMLElement>('.counter-mark')];
  const counterFill = landing.querySelector<HTMLElement>('#tape-counter-fill');
  const counterNow = landing.querySelector<HTMLElement>('#tape-counter-now');
  const tabs = [...landing.querySelectorAll<HTMLButtonElement>('.mmrow')];
  const list = landing.querySelector<HTMLElement>('.mm-list');
  const clock = landing.querySelector<HTMLElement>('#tape-clock');
  const seedInput = landing.querySelector<HTMLInputElement>('#tape-seed');
  const seedLabel = landing.querySelector<HTMLElement>('#tape-seed-label');
  const loadTape = landing.querySelector<HTMLButtonElement>('#btn-play-tape');

  if (!counterFill || !counterNow || !list || !clock || !seedInput || !seedLabel || !loadTape) return;

  seedInput.value = String(Math.trunc(seed));
  seedLabel.textContent = String(Math.trunc(seed));

  const openedAt = Date.now();
  updateClock(clock, openedAt);
  window.setInterval(() => updateClock(clock, openedAt), 40);

  let cutTimer: number | null = null;
  const cutTo = (index: number): void => {
    const shot = shots[index];
    const segment = SEGMENTS[index];
    if (!shot || !segment) return;

    const changed = !shot.classList.contains('is-on');
    shots.forEach((candidate) => candidate.classList.toggle('is-on', candidate === shot));
    bleeds.forEach((bleed) => { bleed.src = shot.src; });
    marks.forEach((mark) => mark.setAttribute('data-on', mark.dataset.i === String(index) ? '1' : '0'));
    counterFill.style.width = `${segment.position}%`;
    counterNow.textContent = `${segment.timecode} · ${segment.level}`;

    if (!changed) return;
    landing.classList.add('is-cut');
    if (cutTimer !== null) window.clearTimeout(cutTimer);
    cutTimer = window.setTimeout(() => landing.classList.remove('is-cut'), 90);
  };

  const markScroll = (): void => {
    landing.querySelectorAll<HTMLElement>('.mm-panel').forEach((panel) => {
      if (panel.hidden) return;
      const body = panel.querySelector<HTMLElement>('.mm-body');
      if (!body) return;
      panel.classList.toggle('can-scroll', body.scrollHeight - body.clientHeight > 8);
    });
  };

  const select = (tab: HTMLButtonElement, focus: boolean): void => {
    tabs.forEach((candidate) => {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      const panelId = candidate.getAttribute('aria-controls');
      const panel = panelId ? document.getElementById(panelId) : null;
      if (panel) panel.hidden = !selected;
    });
    if (focus) tab.focus();
    cutTo(Number(tab.dataset.seg));
    markScroll();
  };

  tabs.forEach((tab) => tab.addEventListener('click', () => select(tab, true)));
  list.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const moves: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowRight: index + 1,
      ArrowUp: index - 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(tabs[(next + tabs.length) % tabs.length], true);
  });

  landing.querySelectorAll<HTMLButtonElement>('.ix').forEach((button) => {
    button.addEventListener('click', () => {
      landing.querySelectorAll<HTMLButtonElement>('.ix').forEach((candidate) => {
        candidate.setAttribute('aria-pressed', String(candidate === button));
      });
      cutTo(Number(button.dataset.seg));
    });
  });

  landing.querySelectorAll<HTMLElement>('.mm-body').forEach((body) => {
    body.addEventListener('scroll', () => {
      const panel = body.closest<HTMLElement>('.mm-panel');
      if (panel) panel.classList.toggle('can-scroll', body.scrollHeight - body.scrollTop - body.clientHeight > 8);
    }, { passive: true });
  });
  window.addEventListener('resize', markScroll, { passive: true });

  loadTape.addEventListener('click', () => {
    const nextSeed = parseSeed(seedInput.value);
    if (nextSeed === null) {
      seedInput.setCustomValidity('Enter a whole number from 1 to 4,294,967,295.');
      seedInput.reportValidity();
      return;
    }
    seedInput.setCustomValidity('');
    const url = new URL(location.href);
    url.searchParams.set('seed', String(nextSeed));
    location.assign(url.toString());
  });
  seedInput.addEventListener('input', () => seedInput.setCustomValidity(''));

  cutTo(0);
  markScroll();
  window.setTimeout(markScroll, 250);
}
