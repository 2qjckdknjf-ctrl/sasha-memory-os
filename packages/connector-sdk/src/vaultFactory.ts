import {
  createLocalVaultStore,
  type VaultStore,
  type VaultTokenRecord,
} from './vault.js';

export type VaultBackend = 'local' | 'memory' | 'supabase';

/** In-memory vault for tests / ephemeral workers. Never persists tokens to disk. */
export function createMemoryVaultStore(): VaultStore {
  const records = new Map<string, VaultTokenRecord>();
  return {
    async put(record) {
      records.set(record.vaultRef, { ...record });
    },
    async get(vaultRef) {
      const hit = records.get(vaultRef);
      return hit ? { ...hit } : null;
    },
    async delete(vaultRef) {
      records.delete(vaultRef);
    },
  };
}

export function resolveVaultBackend(
  env: NodeJS.ProcessEnv = process.env,
): VaultBackend {
  const raw = (env.MEMORY_OS_VAULT_BACKEND ?? '').trim().toLowerCase();
  if (raw === 'memory') return 'memory';
  if (raw === 'local') return 'local';
  if (raw === 'supabase') return 'supabase';
  // Default: shared DB vault when Supabase is configured, else local files.
  if (env.MEMORY_OS_SUPABASE_URL?.trim()) return 'supabase';
  return 'local';
}

export type VaultStoreFactoryOptions = {
  env?: NodeJS.ProcessEnv;
  /** Required when backend resolves to supabase. */
  supabaseVault?: VaultStore;
};

/**
 * Factory for connector token vault backends.
 * For `supabase`, pass `supabaseVault` from `@memory-os/db` createSupabaseVaultStore().
 */
export function createVaultStore(options: VaultStoreFactoryOptions = {}): VaultStore {
  const processEnv = options.env ?? process.env;
  const backend = resolveVaultBackend(processEnv);
  if (backend === 'memory') return createMemoryVaultStore();
  if (backend === 'local') return createLocalVaultStore(processEnv);
  if (!options.supabaseVault) {
    throw new Error(
      'MEMORY_OS_VAULT_BACKEND=supabase requires createVaultStore({ supabaseVault })',
    );
  }
  return options.supabaseVault;
}
