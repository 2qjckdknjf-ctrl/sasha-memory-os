import {
  createCiphertextVaultStore,
  createVaultStore,
  resolveVaultBackend,
  type VaultStore,
  type VaultTokenRecord,
} from '@memory-os/connector-sdk';
import type { SupabaseMemoryGateway } from './gateway.js';

export function createSupabaseVaultStore(
  gateway: SupabaseMemoryGateway,
  env: NodeJS.ProcessEnv = process.env,
): VaultStore {
  return createCiphertextVaultStore({
    env,
    async putCiphertext(vaultRef, ciphertextBase64) {
      await gateway.vaultPut({ vaultRef, ciphertextBase64 });
    },
    async getCiphertext(vaultRef) {
      const row = await gateway.vaultGet(vaultRef);
      if (!row.found || !row.ciphertext) return null;
      return row.ciphertext;
    },
    async deleteCiphertext(vaultRef) {
      await gateway.vaultDelete(vaultRef);
    },
  });
}

/**
 * Managed KMS vault via supabase_vault extension.
 * Stores sealed AES-GCM ciphertext as vault.secrets plaintext payload
 * (envelope still uses MEMORY_OS_VAULT_KEY; secret at rest is KMS-backed).
 */
export function createSupabaseVaultKmsStore(
  gateway: SupabaseMemoryGateway,
  env: NodeJS.ProcessEnv = process.env,
): VaultStore {
  return createCiphertextVaultStore({
    env,
    async putCiphertext(vaultRef, ciphertextBase64) {
      await gateway.vaultKmsPut({ vaultRef, plaintext: ciphertextBase64 });
    },
    async getCiphertext(vaultRef) {
      const row = await gateway.vaultKmsGet(vaultRef);
      if (!row.found || !row.plaintext) return null;
      return row.plaintext;
    },
    async deleteCiphertext(vaultRef) {
      await gateway.vaultKmsDelete(vaultRef);
    },
  });
}

/** Prefer shared Supabase vault when configured; else local/memory factory. */
export function createConfiguredVaultStore(options?: {
  gateway?: SupabaseMemoryGateway | null;
  env?: NodeJS.ProcessEnv;
}): VaultStore {
  const env = options?.env ?? process.env;
  const backend = resolveVaultBackend(env);
  if (backend === 'supabase' || backend === 'supabase_vault') {
    if (!options?.gateway) {
      throw new Error(
        'Shared supabase vault requires a gateway (set MEMORY_OS_VAULT_BACKEND=local to use files)',
      );
    }
    if (backend === 'supabase_vault') {
      return createSupabaseVaultKmsStore(options.gateway, env);
    }
    return createSupabaseVaultStore(options.gateway, env);
  }
  return createVaultStore({ env });
}

export type { VaultStore, VaultTokenRecord };
