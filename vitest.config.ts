import { defineConfig } from 'vitest/config';

// Browser-side logic and source-contract checks run in Node/jsdom. The Worker
// handler has a separate config so its tests execute inside workerd.
export default defineConfig({
  test: {
    name: 'unit',
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'tests/worker/contract.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
