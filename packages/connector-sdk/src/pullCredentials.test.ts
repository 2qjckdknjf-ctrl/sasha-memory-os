import { describe, expect, it } from 'vitest';
import { resolvePullCredentials } from './pullCredentials.js';
import { createMemoryVaultStore } from './vaultFactory.js';

describe('resolvePullCredentials', () => {
  it('returns stub when mode is stub', async () => {
    const result = await resolvePullCredentials({
      vaultRef: 'vault:local/connectors/github/x',
      processEnv: { MEMORY_OS_CONNECTOR_PULL_MODE: 'stub' },
      vault: createMemoryVaultStore(),
    });
    expect(result.mode).toBe('stub');
  });

  it('returns vault mode when token present', async () => {
    const vault = createMemoryVaultStore();
    const vaultRef = 'vault:local/connectors/github/x';
    await vault.put({
      vaultRef,
      accessToken: 'tok',
      provider: 'github',
      storedAt: '2026-08-11T12:00:00.000Z',
    });
    const result = await resolvePullCredentials({
      vaultRef,
      processEnv: { MEMORY_OS_CONNECTOR_PULL_MODE: 'auto' },
      vault,
    });
    expect(result.mode).toBe('vault');
    if (result.mode === 'vault') {
      expect(result.accessToken).toBe('tok');
    }
  });

  it('throws in vault mode when token missing', async () => {
    await expect(
      resolvePullCredentials({
        vaultRef: 'vault:local/connectors/github/missing',
        processEnv: { MEMORY_OS_CONNECTOR_PULL_MODE: 'vault' },
        vault: createMemoryVaultStore(),
      }),
    ).rejects.toThrow(/vault token missing/);
  });

  it('throws in auto+strict when token missing', async () => {
    await expect(
      resolvePullCredentials({
        vaultRef: 'vault:local/connectors/github/missing',
        processEnv: {
          MEMORY_OS_CONNECTOR_PULL_MODE: 'auto',
          MEMORY_OS_CONNECTOR_PULL_STRICT: '1',
        },
        vault: createMemoryVaultStore(),
      }),
    ).rejects.toThrow(/PULL_STRICT/);
  });

  it('refreshes expired vault tokens', async () => {
    const vault = createMemoryVaultStore();
    const vaultRef = 'vault:local/connectors/github/expired';
    await vault.put({
      vaultRef,
      accessToken: 'old',
      refreshToken: 'refresh-me',
      expiresAt: '2020-01-01T00:00:00.000Z',
      provider: 'github',
      storedAt: '2020-01-01T00:00:00.000Z',
    });
    const fetchImpl = async () =>
      Response.json({
        access_token: 'new-token',
        expires_in: 3600,
        token_type: 'bearer',
      });
    const result = await resolvePullCredentials({
      vaultRef,
      processEnv: {
        MEMORY_OS_CONNECTOR_PULL_MODE: 'vault',
        MEMORY_OS_OAUTH_GITHUB_CLIENT_ID: 'cid',
        MEMORY_OS_OAUTH_GITHUB_CLIENT_SECRET: 'csec',
      },
      vault,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.mode).toBe('vault');
    if (result.mode === 'vault') {
      expect(result.accessToken).toBe('new-token');
    }
    const stored = await vault.get(vaultRef);
    expect(stored?.accessToken).toBe('new-token');
  });
});
