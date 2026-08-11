import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exchangeAuthorizationCode,
  fingerprintAuthorizationCode,
} from './tokenExchange.js';
import { createLocalVaultStore } from './vault.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('exchangeAuthorizationCode', () => {
  it('never claims tokens were persisted and fingerprints the code', async () => {
    const result = await exchangeAuthorizationCode({
      connectorId: 'github',
      connectionId: '88888888-8888-4888-8888-888888888801',
      code: 'oauth-code-xyz',
      envName: 'local',
      env: {},
    });
    expect(result.tokenPersisted).toBe(false);
    expect(result.exchangeMode).toBe('stub');
    expect(result.codeFingerprint).toBe(
      fingerprintAuthorizationCode('oauth-code-xyz'),
    );
    expect(result.vaultRef).toContain('vault:local/connectors/github/');
    expect(JSON.stringify(result)).not.toContain('oauth-code-xyz');
  });

  it('marks credentials_ready on dry-run when client id+secret and code present', async () => {
    const result = await exchangeAuthorizationCode({
      connectorId: 'github',
      connectionId: '88888888-8888-4888-8888-888888888801',
      code: 'abc',
      dryRun: true,
      env: {
        MEMORY_OS_OAUTH_GITHUB_CLIENT_ID: 'cid',
        MEMORY_OS_OAUTH_GITHUB_CLIENT_SECRET: 'csec',
      },
    });
    expect(result.exchangeMode).toBe('credentials_ready');
    expect(result.clientIdConfigured).toBe(true);
    expect(result.clientSecretConfigured).toBe(true);
  });

  it('exchanges via HTTP and stores tokens in vault only', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-vault-'));
    dirs.push(dir);
    const vault = createLocalVaultStore({
      MEMORY_OS_VAULT_DIR: dir,
      MEMORY_OS_VAULT_KEY: 'test-vault-key',
    });
    const fetchImpl = vi.fn(async () =>
      Response.json({
        access_token: 'gho_test_token',
        refresh_token: 'ghr_test_refresh',
        token_type: 'bearer',
        scope: 'repo',
      }),
    );

    const result = await exchangeAuthorizationCode({
      connectorId: 'github',
      connectionId: '88888888-8888-4888-8888-888888888801',
      code: 'provider-code',
      env: {
        MEMORY_OS_OAUTH_GITHUB_CLIENT_ID: 'cid',
        MEMORY_OS_OAUTH_GITHUB_CLIENT_SECRET: 'csec',
      },
      vault,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.exchangeMode).toBe('exchanged');
    expect(result.tokenPersisted).toBe(false);
    expect(JSON.stringify(result)).not.toContain('gho_test_token');
    expect(fetchImpl).toHaveBeenCalledOnce();

    const stored = await vault.get(result.vaultRef);
    expect(stored?.accessToken).toBe('gho_test_token');
    expect(stored?.refreshToken).toBe('ghr_test_refresh');
  });
});
