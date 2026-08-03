import { defineConfig } from 'vite';

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    cloudflare({
      tunnel: { autoStart: true },
    }),
  ],
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    // The footstep clips are small enough that Vite would base64 them straight
    // into the game bundle, which costs 33% in size and drags them onto the
    // critical path. They are fetched lazily on purpose — keep them as files.
    assetsInlineLimit: (file) => (file.endsWith('.mp3') ? false : undefined),
  },
});