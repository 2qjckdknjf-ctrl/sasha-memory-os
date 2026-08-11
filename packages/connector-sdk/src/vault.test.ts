import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalVaultStore } from './vault.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('createLocalVaultStore', () => {
  it('round-trips tokens without writing plaintext secrets to the path name', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-vault-'));
    dirs.push(dir);
    const vault = createLocalVaultStore({
      MEMORY_OS_VAULT_DIR: dir,
      MEMORY_OS_VAULT_KEY: 'test-vault-key',
    });
    const vaultRef = 'vault:local/connectors/github/88888888-8888-4888-8888-888888888801';
    await vault.put({
      vaultRef,
      accessToken: 'gho_secret_access',
      refreshToken: 'ghr_secret_refresh',
      tokenType: 'bearer',
      provider: 'github',
      storedAt: '2026-08-11T12:00:00.000Z',
    });
    const loaded = await vault.get(vaultRef);
    expect(loaded?.accessToken).toBe('gho_secret_access');
    expect(loaded?.refreshToken).toBe('ghr_secret_refresh');
    expect(path.basename(dir)).not.toContain('gho_');
  });
});
