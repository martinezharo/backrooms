// jsdom is missing a few things the game reads at module scope.

import { beforeEach, vi } from 'vitest';

// Quality and controls both branch on this, and jsdom has no implementation at
// all — an unstubbed call throws rather than returning "not a touchscreen".
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  localStorage.clear();
  document.body.className = '';
  vi.unstubAllGlobals();
});
