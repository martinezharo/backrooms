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
  fuse: wrap(
    '<rect x="6.5" y="9" width="11" height="6" rx="1"/>'
    + '<rect x="2.5" y="9.8" width="4" height="4.4" rx="0.8"/>'
    + '<rect x="17.5" y="9.8" width="4" height="4.4" rx="0.8"/>'
    + '<path d="M8.5 12h7" fill="none" stroke="#0e0c04" stroke-width="1.4"/>',
  ),
  battery: wrap(
    '<rect x="4" y="7" width="14" height="10" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.9"/>'
    + '<rect x="18.6" y="10" width="2.4" height="4" rx="0.8"/>'
    + '<rect x="6.2" y="9.2" width="4" height="5.6" rx="0.7"/>',
  ),
  detector: wrap(
    '<rect x="4.5" y="8.5" width="12" height="11" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8"/>'
    + '<rect x="6.8" y="10.8" width="7.4" height="4.4" rx="0.8"/>'
    + '<path d="M16 8.5 20 3.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
    + '<circle cx="20.4" cy="2.6" r="1.5"/>',
  ),
  flashlight: wrap(
    '<path d="M8.5 2.5h7l-1.2 6h-4.6l-1.2-6z"/>'
    + '<path d="M9.8 9.5h4.4V20a1.4 1.4 0 0 1-1.4 1.4h-1.6A1.4 1.4 0 0 1 9.8 20V9.5z"/>'
    + '<path d="M5.2 3.6l1.7 1.4M18.8 3.6l-1.7 1.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  ),
};

/** Glyphs for the on-screen controls — a phone reads a picture faster than
 *  it reads a four-letter abbreviation. */
const CONTROLS: Record<string, string> = {
  bag: wrap(
    '<path d="M9.2 7V5.8a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
    + '<path d="M6.8 7.4h10.4a3.8 3.8 0 0 1 3.8 3.8v6.4A3.4 3.4 0 0 1 17.6 21H6.4A3.4 3.4 0 0 1 3 17.6v-6.4a3.8 3.8 0 0 1 3.8-3.8z"/>'
    + '<rect x="3" y="12.4" width="18" height="2.6" fill="#0e0c04"/>'
    + '<rect x="10.2" y="15.4" width="3.6" height="3.6" rx="0.9" fill="#0e0c04"/>',
  ),
  torch: ICONS.flashlight,
  signal: wrap(
    '<rect x="7.5" y="12" width="9" height="9.2" rx="1.4"/>'
    + '<path d="M12 12V6.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
    + '<circle cx="12" cy="4.6" r="1.7"/>'
    + '<path d="M6.6 8.4a7 7 0 0 1 0-4.6M17.4 8.4a7 7 0 0 0 0-4.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  ),
  drop: wrap(
    '<path d="M12 2.6v10.2M12 14.6l-4-4M12 14.6l4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M4 17.4v2.2a1.8 1.8 0 0 0 1.8 1.8h12.4a1.8 1.8 0 0 0 1.8-1.8v-2.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  ),
  pause: wrap('<rect x="6.5" y="4.5" width="4" height="15" rx="1"/><rect x="13.5" y="4.5" width="4" height="15" rx="1"/>'),
};

const FALLBACK = wrap('<circle cx="12" cy="12" r="6"/>');

/** SVG markup for an item id (inventory tiles, hotbar, drag ghost). */
export function itemIcon(id: string): string {
  return ICONS[id] ?? FALLBACK;
}

/** SVG markup for an on-screen control button. */
export function controlIcon(id: string): string {
  return CONTROLS[id] ?? FALLBACK;
}
