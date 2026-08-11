import { describe, expect, it } from 'vitest';
import { exchangeAuthorizationCode, fingerprintAuthorizationCode } from './tokenExchange.js';

describe('exchangeAuthorizationCode', () => {
  it('never claims tokens were persisted and fingerprints the code', () => {
    const result = exchangeAuthorizationCode({
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

  it('marks credentials_ready when client id+secret and code present', () => {
    const result = exchangeAuthorizationCode({
      connectorId: 'github',
      connectionId: '88888888-8888-4888-8888-888888888801',
      code: 'abc',
      env: {
        MEMORY_OS_OAUTH_GITHUB_CLIENT_ID: 'cid',
        MEMORY_OS_OAUTH_GITHUB_CLIENT_SECRET: 'csec',
      },
    });
    expect(result.exchangeMode).toBe('credentials_ready');
    expect(result.clientIdConfigured).toBe(true);
    expect(result.clientSecretConfigured).toBe(true);
  });
});
