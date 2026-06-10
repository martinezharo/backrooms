// Inline SVG icon set — no image assets, everything tinted via currentColor.

const wrap = (inner: string): string =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">${inner}</svg>`;

const ICONS: Record<string, string> = {
  wrench: wrap(
    '<path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>',
  ),
  knife: wrap(
    '<path d="M21.5 2.5c-5.5.6-12 4.8-16.6 10.5l3.4 3.4C13 13 18 8.5 21.9 3l-.4-.5z"/>'
    + '<path d="M7 17.5 4.6 15 2.5 19.6c-.4.9.5 1.8 1.4 1.4L8.5 19 7 17.5z"/>',
  ),
  pipe: wrap(
    '<path d="M18.2 2.6l3.2 3.2L7.4 19.8l-3.2-3.2z"/>'
    + '<circle cx="19.8" cy="4.2" r="1.9"/>'
    + '<path d="M5.8 18.2 2.6 21.4l-.4-3.6 3.6.4z"/>',
  ),
  bottle: wrap(
    '<path d="M10 2h4v3.2c0 1.3 2.5 2.3 2.5 5.3V20a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-9.5c0-3 2.5-4 2.5-5.3V2z"/>',
  ),
  pistol: wrap(
    '<path d="M2 7h19v2.2h-1.4l-1 3.4a1.5 1.5 0 0 1-1.4 1.1h-4.4l-1.5 4.8H5.6l1.7-5.5H5l-.8 1.7H2V7z"/>',
  ),
  ammo: wrap(
    '<rect x="3.5" y="6.5" width="17" height="12.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/>'
    + '<rect x="6.9" y="10" width="2.4" height="6" rx="1.2"/>'
    + '<rect x="10.8" y="10" width="2.4" height="6" rx="1.2"/>'
    + '<rect x="14.7" y="10" width="2.4" height="6" rx="1.2"/>',
  ),
  extinguisher: wrap(
    '<path d="M9.2 8.5a2.8 2.8 0 0 1 5.6 0V20a1.6 1.6 0 0 1-1.6 1.6h-2.4A1.6 1.6 0 0 1 9.2 20V8.5z"/>'
    + '<rect x="11" y="3.2" width="2" height="2.6"/>'
    + '<path d="M11.6 4.4C8.5 4.4 6.6 6 6.3 8.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  ),
  flashlight: wrap(
    '<path d="M8.5 2.5h7l-1.2 6h-4.6l-1.2-6z"/>'
    + '<path d="M9.8 9.5h4.4V20a1.4 1.4 0 0 1-1.4 1.4h-1.6A1.4 1.4 0 0 1 9.8 20V9.5z"/>'
    + '<path d="M5.2 3.6l1.7 1.4M18.8 3.6l-1.7 1.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  ),
};

const FALLBACK = wrap('<circle cx="12" cy="12" r="6"/>');

/** SVG markup for an item id (inventory tiles, hotbar, drag ghost). */
export function itemIcon(id: string): string {
  return ICONS[id] ?? FALLBACK;
}
