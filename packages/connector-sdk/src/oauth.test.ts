import { describe, expect, it } from 'vitest';
import {
  resolveAuthorizeBase,
  resolveOAuthClientId,
  vaultRefForAccount,
} from './oauth.js';

describe('vaultRefForAccount', () => {
  it('builds vault reference without embedding secrets', () => {
    expect(
      vaultRefForAccount({
        env: 'local',
        connectorId: 'github',
        accountId: '88888888-8888-4888-8888-888888888801',
      }),
    ).toBe(
      'vault:local/connectors/github/88888888-8888-4888-8888-888888888801',
    );
  });
});

describe('resolveAuthorizeBase', () => {
  it('returns null without client id or explicit authorize URL', () => {
    expect(
      resolveAuthorizeBase('github', {
        MEMORY_OS_OAUTH_GITHUB_CLIENT_ID: '',
        MEMORY_OS_OAUTH_GITHUB_AUTHORIZE_URL: '',
      }),
    ).toBeNull();
  });

  it('appends client_id to default GitHub authorize URL', () => {
    const url = resolveAuthorizeBase('github', {
      MEMORY_OS_OAUTH_GITHUB_CLIENT_ID: 'gh-client-123',
    });
    expect(url).toContain('https://github.com/login/oauth/authorize');
    expect(url).toContain('client_id=gh-client-123');
    expect(resolveOAuthClientId('github', {
      MEMORY_OS_OAUTH_GITHUB_CLIENT_ID: 'gh-client-123',
    })).toBe('gh-client-123');
  });
});
