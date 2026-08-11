import { describe, expect, it } from 'vitest';
import { pullGithubStubDelta } from './sync.js';

describe('pullGithubStubDelta', () => {
  it('returns vault ref and synthetic PR/issue items without tokens', () => {
    const result = pullGithubStubDelta({
      env: 'local',
      connectionId: '88888888-8888-4888-8888-888888888801',
      displayName: 'AISTROYKA repos',
    });
    expect(result.vaultRef).toContain('vault:local/connectors/github/');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.title).toMatch(/PR #215/);
    expect(result.items.every((i) => i.text.includes(result.vaultRef))).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toMatch(/Bearer\s|client_secret|access_token/i);
  });
});
