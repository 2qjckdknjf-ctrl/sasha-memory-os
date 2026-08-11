/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MEMORY_API_URL?: string;
  readonly VITE_MEMORY_OS_SUPABASE_URL?: string;
  readonly VITE_MEMORY_OS_SUPABASE_ANON_KEY?: string;
  /** Private demo only — do not use in public builds. */
  readonly VITE_MEMORY_API_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
