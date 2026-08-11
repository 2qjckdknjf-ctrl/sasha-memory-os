import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalVaultStore } from '@memory-os/connector-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  pullGoogleCalendarDelta,
  pullGoogleCalendarStubDelta,
} from './sync.js';

describe('pullGoogleCalendarDelta', () => {
  it('returns stub event without tokens', () => {
    const result = pullGoogleCalendarStubDelta({
      connectionId: '88888888-8888-4888-8888-888888888804',
    });
    expect(result.mode).toBe('stub');
    expect(result.items[0]?.title).toMatch(/standup/i);
  });

  it('uses vault-backed Calendar events when token present', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-cal-'));
    try {
      const processEnv = {
        MEMORY_OS_ENV: 'local',
        MEMORY_OS_CONNECTOR_PULL_MODE: 'auto',
        MEMORY_OS_VAULT_DIR: dir,
        MEMORY_OS_VAULT_KEY: 'test-vault-key',
      };
      const vault = createLocalVaultStore(processEnv);
      const vaultRef =
        'vault:local/connectors/google-calendar/88888888-8888-4888-8888-888888888804';
      await vault.put({
        vaultRef,
        accessToken: 'ya29.cal',
        provider: 'google-calendar',
        storedAt: '2026-08-11T12:00:00.000Z',
      });
      const fetchImpl = vi.fn(async () =>
        Response.json({
          items: [
            {
              id: 'e1',
              summary: 'Memory OS review',
              status: 'confirmed',
              updated: '2026-08-11T09:00:00.000Z',
              start: { dateTime: '2026-08-12T10:00:00.000Z' },
              end: { dateTime: '2026-08-12T10:30:00.000Z' },
            },
          ],
        }),
      );
      const result = await pullGoogleCalendarDelta({
        connectionId: '88888888-8888-4888-8888-888888888804',
        processEnv,
        vault,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(result.mode).toBe('vault');
      expect(result.items[0]?.title).toMatch(/Memory OS review/);
      expect(JSON.stringify(result)).not.toContain('ya29.cal');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
