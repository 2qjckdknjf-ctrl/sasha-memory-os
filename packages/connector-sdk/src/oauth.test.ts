import { describe, expect, it } from 'vitest';
import { vaultRefForAccount } from './oauth.js';

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
