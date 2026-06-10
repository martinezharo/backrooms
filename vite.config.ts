import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [],
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
