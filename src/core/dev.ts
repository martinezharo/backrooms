// Development hacks.
//
// Everything gated on DEV_HACKS is for working on the game, never for playing
// it: jumping between floors, and the `window.__game` handle the headless
// scripts drive. The flag is one env var, read at build time — Vite inlines
// `import.meta.env.VITE_HACKS` as a literal, so in a production bundle every
// check below folds to `false` and the code behind it is dropped entirely.
//
//   pnpm dev            → .env.development sets VITE_HACKS=dev, hacks on
//   pnpm build/deploy   → nothing sets it, hacks gone from the bundle
//   VITE_HACKS=dev pnpm build → a production-shaped build that keeps them
export const DEV_HACKS = import.meta.env.VITE_HACKS === 'dev';
