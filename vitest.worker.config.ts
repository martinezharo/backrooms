import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// These tests execute in workerd with the same entry point, compatibility date
// and bindings declared for the deployed Worker.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    name: 'worker',
    include: ['tests/worker/telemetry.test.ts'],
  },
});
