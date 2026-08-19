import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createLocalVaultStore,
  runConnectorCertificationSmoke,
} from '@memory-os/connector-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  googleDriveConnector,
  pullGoogleDriveDelta,
  pullGoogleDriveStubDelta,
} from './sync.js';

describe('pullGoogleDriveDelta', () => {
  it('returns stub file event without tokens', () => {
    const result = pullGoogleDriveStubDelta({
      connectionId: '88888888-8888-4888-8888-888888888803',
    });
    expect(result.mode).toBe('stub');
    expect(result.items[0]?.title).toMatch(/Project brief/);
  });

  it('uses vault-backed Drive files when token present', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-drive-'));
    try {
      const processEnv = {
        MEMORY_OS_ENV: 'local',
        MEMORY_OS_CONNECTOR_PULL_MODE: 'auto',
        MEMORY_OS_VAULT_DIR: dir,
        MEMORY_OS_VAULT_KEY: 'test-vault-key',
      };
      const vault = createLocalVaultStore(processEnv);
      const vaultRef =
        'vault:local/connectors/google-drive/88888888-8888-4888-8888-888888888803';
      await vault.put({
        vaultRef,
        accessToken: 'ya29.drive',
        provider: 'google-drive',
        storedAt: '2026-08-11T12:00:00.000Z',
      });
      const fetchImpl = vi.fn(async () =>
        Response.json({
          files: [
            {
              id: 'f1',
              name: 'Architecture.md',
              mimeType: 'text/markdown',
              modifiedTime: '2026-08-11T10:00:00.000Z',
            },
          ],
        }),
      );
      const result = await pullGoogleDriveDelta({
        connectionId: '88888888-8888-4888-8888-888888888803',
        processEnv,
        vault,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(result.mode).toBe('vault');
      expect(result.items[0]?.title).toMatch(/Architecture.md/);
      expect(JSON.stringify(result)).not.toContain('ya29.drive');
      expect(result.nextCursor?.stream).toBe('google-drive:files');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('filters already-seen Drive files with a persisted cursor', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-drive-cursor-'));
    try {
      const processEnv = {
        MEMORY_OS_ENV: 'local',
        MEMORY_OS_CONNECTOR_PULL_MODE: 'auto',
        MEMORY_OS_VAULT_DIR: dir,
        MEMORY_OS_VAULT_KEY: 'test-vault-key',
      };
      const vault = createLocalVaultStore(processEnv);
      const vaultRef =
        'vault:local/connectors/google-drive/88888888-8888-4888-8888-888888888803';
      await vault.put({
        vaultRef,
        accessToken: 'ya29.drive',
        provider: 'google-drive',
        storedAt: '2026-08-11T12:00:00.000Z',
      });
      const fetchImpl = vi.fn(async () =>
        Response.json({
          files: [
            {
              id: 'f1',
              name: 'Architecture.md',
              mimeType: 'text/markdown',
              modifiedTime: '2026-08-11T10:00:00.000Z',
            },
          ],
        }),
      );
      const result = await pullGoogleDriveDelta({
        connectionId: '88888888-8888-4888-8888-888888888803',
        processEnv,
        vault,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        cursor: {
          stream: 'google-drive:files',
          opaque: {
            lastSeenFileId: 'f1',
            lastSeenModifiedAt: '2026-08-11T10:00:00.000Z',
          },
          schemaVersion: '1.0',
          updatedAt: '2026-08-11T10:00:00.000Z',
        },
      });
      expect(result.mode).toBe('vault');
      expect(result.items).toHaveLength(0);
      expect(result.note).toMatch(/no new files/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('googleDriveConnector certification', () => {
  it('passes SDK certification smoke without Google OAuth secrets', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-drive-cert-'));
    try {
      const processEnv = {
        MEMORY_OS_ENV: 'local',
        MEMORY_OS_CONNECTOR_PULL_MODE: 'auto',
        MEMORY_OS_VAULT_DIR: dir,
        MEMORY_OS_VAULT_KEY: 'test-vault-key',
      };
      const vault = createLocalVaultStore(processEnv);
      const vaultRef =
        'vault:local/connectors/google-drive/88888888-8888-4888-8888-888888888803';
      await vault.put({
        vaultRef,
        accessToken: 'ya29.drive',
        provider: 'google-drive',
        storedAt: '2026-08-11T12:00:00.000Z',
      });
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            files: [
              {
                id: 'f1',
                name: 'Architecture.md',
                mimeType: 'text/markdown',
                modifiedTime: '2026-08-11T10:00:00.000Z',
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            files: [
              {
                id: 'f1',
                name: 'Architecture.md',
                mimeType: 'text/markdown',
                modifiedTime: '2026-08-11T10:00:00.000Z',
              },
            ],
          }),
        )
        .mockResolvedValueOnce(Response.json({ files: [{ id: 'f1' }] }));

      const result = await runConnectorCertificationSmoke({
        connector: googleDriveConnector,
        context: {
          account: {
            connectionId: '88888888-8888-4888-8888-888888888803',
            connectorId: 'google-drive',
            displayName: 'Drive pilot',
            vaultRef,
            scopes: ['files.read'],
          },
          workspaceId: '11111111-1111-4111-8111-111111111111',
          processEnv,
          vault,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      });

      expect(result.records).toHaveLength(1);
      expect(result.nextCursor?.opaque.lastSeenFileId).toBe('f1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
