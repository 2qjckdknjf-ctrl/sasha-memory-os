import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createLocalVaultStore,
  runConnectorCertificationSmoke,
} from '@memory-os/connector-sdk';
import { describe, expect, it, vi } from 'vitest';
import { githubConnector, pullGithubDelta, pullGithubStubDelta } from './sync.js';

describe('pullGithubStubDelta', () => {
  it('returns synthetic PR/issue items without tokens', () => {
    const result = pullGithubStubDelta({
      env: 'local',
      connectionId: '88888888-8888-4888-8888-888888888801',
      displayName: 'AISTROYKA repos',
    });
    expect(result.vaultRef).toContain('vault:local/connectors/github/');
    expect(result.mode).toBe('stub');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.title).toMatch(/PR #215/);
    expect(result.nextCursor?.stream).toBe('github:user-events');
    expect(JSON.stringify(result)).not.toMatch(/Bearer\s|client_secret|access_token/i);
  });
});

describe('pullGithubDelta', () => {
  it('uses vault-backed GitHub events when token is present', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-gh-vault-'));
    try {
      const processEnv = {
        MEMORY_OS_ENV: 'local',
        MEMORY_OS_CONNECTOR_PULL_MODE: 'auto',
        MEMORY_OS_VAULT_DIR: dir,
        MEMORY_OS_VAULT_KEY: 'test-vault-key',
      };
      const vault = createLocalVaultStore(processEnv);
      const vaultRef =
        'vault:local/connectors/github/88888888-8888-4888-8888-888888888801';
      await vault.put({
        vaultRef,
        accessToken: 'gho_test',
        provider: 'github',
        storedAt: '2026-08-11T12:00:00.000Z',
      });

      const fetchImpl = vi.fn(async () =>
        Response.json([
          {
            id: '123',
            type: 'PullRequestEvent',
            created_at: '2026-08-11T11:00:00.000Z',
            repo: { name: 'aistroyka/core' },
            payload: {
              action: 'closed',
              pull_request: { number: 215, title: 'Product Design Audit' },
            },
          },
        ]),
      );

      const result = await pullGithubDelta({
        connectionId: '88888888-8888-4888-8888-888888888801',
        displayName: 'AISTROYKA repos',
        processEnv,
        vault,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      expect(result.mode).toBe('vault');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.title).toMatch(/PR #215/);
      expect(JSON.stringify(result)).not.toContain('gho_test');
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(result.nextCursor?.opaque.lastSeenEventId).toBe('123');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to stub in auto mode without vault token', async () => {
    const result = await pullGithubDelta({
      connectionId: '88888888-8888-4888-8888-888888888801',
      processEnv: {
        MEMORY_OS_CONNECTOR_PULL_MODE: 'auto',
        MEMORY_OS_VAULT_DIR: path.join(os.tmpdir(), 'memory-os-empty-vault'),
        MEMORY_OS_VAULT_KEY: 'test-vault-key',
      },
    });
    expect(result.mode).toBe('stub');
    expect(result.items).toHaveLength(2);
  });

  it('filters already-seen events with a persisted cursor', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-gh-cursor-'));
    try {
      const processEnv = {
        MEMORY_OS_ENV: 'local',
        MEMORY_OS_CONNECTOR_PULL_MODE: 'auto',
        MEMORY_OS_VAULT_DIR: dir,
        MEMORY_OS_VAULT_KEY: 'test-vault-key',
      };
      const vault = createLocalVaultStore(processEnv);
      const vaultRef =
        'vault:local/connectors/github/88888888-8888-4888-8888-888888888801';
      await vault.put({
        vaultRef,
        accessToken: 'gho_test',
        provider: 'github',
        storedAt: '2026-08-11T12:00:00.000Z',
      });

      const fetchImpl = vi.fn(async () =>
        Response.json([
          {
            id: '123',
            type: 'PullRequestEvent',
            created_at: '2026-08-11T11:00:00.000Z',
            repo: { name: 'aistroyka/core' },
            payload: {
              action: 'closed',
              pull_request: { number: 215, title: 'Product Design Audit' },
            },
          },
        ]),
      );

      const result = await pullGithubDelta({
        connectionId: '88888888-8888-4888-8888-888888888801',
        processEnv,
        vault,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        cursor: {
          stream: 'github:user-events',
          opaque: {
            lastSeenEventId: '123',
            lastSeenObservedAt: '2026-08-11T11:00:00.000Z',
          },
          schemaVersion: '1.0',
          updatedAt: '2026-08-11T11:00:00.000Z',
        },
      });

      expect(result.mode).toBe('vault');
      expect(result.items).toHaveLength(0);
      expect(result.note).toMatch(/no new user events/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('githubConnector certification', () => {
  it('passes SDK certification smoke without GitHub OAuth secrets', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-gh-cert-'));
    try {
      const processEnv = {
        MEMORY_OS_ENV: 'local',
        MEMORY_OS_CONNECTOR_PULL_MODE: 'auto',
        MEMORY_OS_VAULT_DIR: dir,
        MEMORY_OS_VAULT_KEY: 'test-vault-key',
      };
      const vault = createLocalVaultStore(processEnv);
      const vaultRef =
        'vault:local/connectors/github/88888888-8888-4888-8888-888888888801';
      await vault.put({
        vaultRef,
        accessToken: 'gho_test',
        provider: 'github',
        storedAt: '2026-08-11T12:00:00.000Z',
      });

      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json([
            {
              id: '123',
              type: 'PullRequestEvent',
              created_at: '2026-08-11T11:00:00.000Z',
              repo: { name: 'aistroyka/core' },
              payload: {
                action: 'closed',
                pull_request: { number: 215, title: 'Product Design Audit' },
              },
            },
          ]),
        )
        .mockResolvedValueOnce(
          Response.json([
            {
              id: '123',
              type: 'PullRequestEvent',
              created_at: '2026-08-11T11:00:00.000Z',
              repo: { name: 'aistroyka/core' },
              payload: {
                action: 'closed',
                pull_request: { number: 215, title: 'Product Design Audit' },
              },
            },
          ]),
        )
        .mockResolvedValueOnce(new Response('{}', { status: 200 }));

      const result = await runConnectorCertificationSmoke({
        connector: githubConnector,
        context: {
          account: {
            connectionId: '88888888-8888-4888-8888-888888888801',
            connectorId: 'github',
            displayName: 'AISTROYKA repos',
            vaultRef,
            scopes: ['repositories.read'],
          },
          workspaceId: '11111111-1111-4111-8111-111111111111',
          processEnv,
          vault,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      });

      expect(result.records).toHaveLength(1);
      expect(result.nextCursor?.opaque.lastSeenEventId).toBe('123');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
