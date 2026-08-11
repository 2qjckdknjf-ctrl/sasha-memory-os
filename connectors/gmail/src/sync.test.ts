import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalVaultStore } from '@memory-os/connector-sdk';
import { describe, expect, it, vi } from 'vitest';
import { pullGmailDelta, pullGmailStubDelta } from './sync.js';

describe('pullGmailDelta', () => {
  it('returns stub metadata without tokens', () => {
    const result = pullGmailStubDelta({
      connectionId: '88888888-8888-4888-8888-888888888802',
      displayName: 'Pilot Gmail',
    });
    expect(result.mode).toBe('stub');
    expect(result.items[0]?.title).toMatch(/Pilot inbox/);
    expect(JSON.stringify(result)).not.toMatch(/Bearer|access_token/i);
  });

  it('uses vault-backed Gmail metadata when token present', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-gmail-'));
    try {
      const processEnv = {
        MEMORY_OS_ENV: 'local',
        MEMORY_OS_CONNECTOR_PULL_MODE: 'auto',
        MEMORY_OS_VAULT_DIR: dir,
        MEMORY_OS_VAULT_KEY: 'test-vault-key',
      };
      const vault = createLocalVaultStore(processEnv);
      const vaultRef =
        'vault:local/connectors/gmail/88888888-8888-4888-8888-888888888802';
      await vault.put({
        vaultRef,
        accessToken: 'ya29.test',
        provider: 'gmail',
        storedAt: '2026-08-11T12:00:00.000Z',
      });

      const fetchImpl = vi.fn(async (url: string) => {
        if (String(url).includes('/messages?')) {
          return Response.json({ messages: [{ id: 'm1' }] });
        }
        return Response.json({
          id: 'm1',
          snippet: 'Kickoff note',
          internalDate: '1723382400000',
          payload: {
            headers: [
              { name: 'Subject', value: 'Memory OS pilot' },
              { name: 'From', value: 'owner@example.com' },
            ],
          },
        });
      });

      const result = await pullGmailDelta({
        connectionId: '88888888-8888-4888-8888-888888888802',
        processEnv,
        vault,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(result.mode).toBe('vault');
      expect(result.items[0]?.title).toMatch(/Memory OS pilot/);
      expect(JSON.stringify(result)).not.toContain('ya29.test');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
