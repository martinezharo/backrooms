/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'dev' turns on the development-only hacks; see core/dev.ts */
  readonly VITE_HACKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
