import { describe, expect, it } from 'vitest';
import {
  createMemoryVaultStore,
  createVaultStore,
  resolveVaultBackend,
} from './vaultFactory.js';

describe('createVaultStore', () => {
  it('uses memory backend when MEMORY_OS_VAULT_BACKEND=memory', async () => {
    const vault = createVaultStore({
      env: { MEMORY_OS_VAULT_BACKEND: 'memory' },
    });
    await vault.put({
      vaultRef: 'vault:local/connectors/github/test',
      accessToken: 'tok',
      provider: 'github',
      storedAt: '2026-08-11T12:00:00.000Z',
    });
    await expect(vault.get('vault:local/connectors/github/test')).resolves.toMatchObject({
      accessToken: 'tok',
    });
  });

  it('memory vault isolates records between instances', async () => {
    const a = createMemoryVaultStore();
    const b = createMemoryVaultStore();
    await a.put({
      vaultRef: 'vault:x',
      accessToken: 'a',
      provider: 'github',
      storedAt: '2026-08-11T12:00:00.000Z',
    });
    await expect(b.get('vault:x')).resolves.toBeNull();
  });

  it('resolves supabase_vault / kms backend aliases', () => {
    expect(
      resolveVaultBackend({ MEMORY_OS_VAULT_BACKEND: 'supabase_vault' }),
    ).toBe('supabase_vault');
    expect(resolveVaultBackend({ MEMORY_OS_VAULT_BACKEND: 'kms' })).toBe(
      'supabase_vault',
    );
  });
});

