import { describe, expect, it, vi } from 'vitest';
import {
  createConnectorRegistry,
  resolveConnectorSyncOutcome,
} from '@memory-os/connector-sdk';
import { parseWorkerIntervalMs, planConnectorSync } from './index.js';

describe('connector-sync outcome policy', () => {
  it('marks unsupported connector as failed', () => {
    expect(
      resolveConnectorSyncOutcome({
        pullMode: 'none',
        note: 'unsupported connector',
      }).status,
    ).toBe('failed');
  });

  it('allows auto stub pulls', () => {
    expect(
      resolveConnectorSyncOutcome({
        pullMode: 'stub',
        processEnv: { MEMORY_OS_CONNECTOR_PULL_MODE: 'auto' },
      }).status,
    ).toBe('succeeded');
  });
});

describe('parseWorkerIntervalMs', () => {
  it('returns null when unset', () => {
    expect(parseWorkerIntervalMs({})).toBeNull();
  });

  it('parses valid interval', () => {
    expect(parseWorkerIntervalMs({ MEMORY_OS_WORKER_INTERVAL_MS: '60000' })).toBe(
      60000,
    );
  });
});

describe('planConnectorSync', () => {
  it('dispatches via the injected connector registry', async () => {
    let initialSyncCalled = false;
    let normalizeCalled = false;
    const connectorRegistry = createConnectorRegistry([
      {
        manifest: {
          id: 'fake-registry',
          version: '1.0.0',
          sdk_version: '^1.0',
          auth: 'oauth2',
          supports: {
            discover: false,
            validate_scope: false,
            initial_sync: true,
            incremental_sync: false,
            live_fetch: false,
            webhooks: false,
            write: false,
          },
          capabilities: ['fixture.read'],
          storage_modes: ['reference'],
          data_classes: ['internal'],
        },
        lifecycle: {
          async initialSync() {
            initialSyncCalled = true;
            return {
              stream: 'fake-registry:stream',
              mode: 'initial' as const,
              pullMode: 'stub',
              note: 'fixture connector sync',
              rawObjects: [
                {
                  externalId: 'fixture/1',
                  title: 'Fixture connector item',
                  observedAt: '2026-08-11T10:00:00.000Z',
                },
              ],
            };
          },
          async normalize(context) {
            normalizeCalled = true;
            return {
              externalObject: {
                provider: 'fake-registry',
                accountId: context.account.connectionId,
                externalId: context.rawObject.externalId,
                objectType: 'fixture',
                title: context.rawObject.title,
                createdAt: context.rawObject.observedAt,
                modifiedAt: context.rawObject.observedAt,
                deleted: false,
                attachments: [],
                permissionsSnapshot: {},
                metadata: {},
              },
              envelope: {
                schema_version: '1.0',
                workspace_id: context.workspaceId,
                source: {
                  provider: 'fake-registry',
                  account_id: context.account.connectionId,
                  external_id: context.rawObject.externalId,
                },
                event_type: 'fake-registry.fixture',
                observed_at: context.rawObject.observedAt,
                idempotency_key: `connector-sync/${context.account.connectionId}/${context.rawObject.externalId}`,
                content: {
                  mime_type: 'text/plain',
                  text: context.rawObject.title,
                },
                scope: {
                  sensitivity: 'internal',
                  storage_mode: 'reference',
                },
                provenance: {
                  sourceMode: 'stub',
                },
              },
              capture: {
                title: context.rawObject.title,
                text: 'fixture text',
                filename: 'fake://fixture/1',
                mimeType: 'text/plain',
                idempotencyKey: `connector-sync/${context.account.connectionId}/${context.rawObject.externalId}`,
              },
            };
          },
        },
      },
    ]);

    const gateway = {
      deadLetterStaleJobs: vi.fn(async () => ({ deadLettered: 0 })),
      listOutboxPending: vi.fn(async () => ({ count: 0 })),
      enqueueConnectorSync: vi.fn(async () => ({
        count: 1,
        enqueued: [
          {
            connectionId: 'conn-1',
            connectorId: 'fake-registry',
            displayName: 'Fixture connector',
            jobId: 'job-1',
          },
        ],
      })),
      getConnectorCursor: vi.fn(async () => null),
      captureText: vi.fn(async () => ({ process: null })),
      upsertConnectorCursor: vi.fn(async () => null),
      completeConnectorSync: vi.fn(async ({ jobId, status }: { jobId: string; status: string }) => ({
        jobId,
        status,
        connectionId: 'conn-1',
      })),
    };

    const plan = await planConnectorSync({
      gateway: gateway as any,
      subjectId: '33333333-3333-4333-8333-333333333301',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      connectorRegistry,
    });

    expect(initialSyncCalled).toBe(true);
    expect(normalizeCalled).toBe(true);
    expect(plan.count).toBe(1);
  });
});
