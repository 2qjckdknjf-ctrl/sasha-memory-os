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
      getConnection: vi.fn(async () => ({
        id: 'conn-1',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        connectorId: 'fake-registry',
        displayName: 'Fixture connector',
        status: 'connected',
        scopes: [],
        lastSyncAt: null,
        lastError: null,
        metadata: {},
      })),
      getConnectorCursor: vi.fn(async () => null),
      refreshConnectionCollections: vi.fn(async () => ({ metadata: {} })),
      mergeConnectionProjectBindings: vi.fn(async () => ({ metadata: {} })),
      upsertProjectFromConnector: vi.fn(async () => ({
        projectId: '44444444-4444-4444-8444-444444444401',
        slug: 'fixture',
        name: 'Fixture',
        memoryId: '66666666-6666-4666-8666-666666666601',
        collectionId: 'fixture',
      })),
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

  it('discovers a new repository on a later tick', async () => {
    let discoverCount = 0;
    const connectorRegistry = createConnectorRegistry([
      {
        manifest: {
          id: 'fake-discover',
          version: '1.0.0',
          sdk_version: '^1.0',
          auth: 'oauth2',
          supports: {
            discover: true,
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
          async discover() {
            discoverCount += 1;
            return {
              collections:
                discoverCount === 1
                  ? [
                      {
                        id: 'team/repo-a',
                        kind: 'repository' as const,
                        name: 'repo-a',
                        title: 'team/repo-a',
                        url: 'https://github.com/team/repo-a',
                        default_branch: 'main',
                        metadata: {},
                      },
                      {
                        id: 'team/repo-b',
                        kind: 'repository' as const,
                        name: 'repo-b',
                        title: 'team/repo-b',
                        url: 'https://github.com/team/repo-b',
                        default_branch: 'main',
                        metadata: {},
                      },
                    ]
                  : [
                      {
                        id: 'team/repo-a',
                        kind: 'repository' as const,
                        name: 'repo-a',
                        title: 'team/repo-a',
                        url: 'https://github.com/team/repo-a',
                        default_branch: 'main',
                        metadata: {},
                      },
                      {
                        id: 'team/repo-b',
                        kind: 'repository' as const,
                        name: 'repo-b',
                        title: 'team/repo-b',
                        url: 'https://github.com/team/repo-b',
                        default_branch: 'main',
                        metadata: {},
                      },
                      {
                        id: 'team/repo-c',
                        kind: 'repository' as const,
                        name: 'repo-c',
                        title: 'team/repo-c',
                        url: 'https://github.com/team/repo-c',
                        default_branch: 'main',
                        metadata: {},
                      },
                    ],
            };
          },
          async initialSync() {
            return {
              stream: 'fake-discover:stream',
              mode: 'initial' as const,
              rawObjects: [],
              pullMode: 'stub',
              note: 'fixture discover sync',
            };
          },
          async normalize() {
            throw new Error('normalize should not be called when there are no events');
          },
        },
      },
    ]);

    let metadataState: Record<string, unknown> = {
      collections: {
        selection_mode: 'all',
        excluded_ids: ['team/repo-b'],
        items: [
          {
            id: 'team/repo-a',
            kind: 'repository',
            name: 'repo-a',
            title: 'team/repo-a',
            url: 'https://github.com/team/repo-a',
            default_branch: 'main',
            metadata: {},
          },
          {
            id: 'team/repo-b',
            kind: 'repository',
            name: 'repo-b',
            title: 'team/repo-b',
            url: 'https://github.com/team/repo-b',
            default_branch: 'main',
            metadata: {},
          },
        ],
        project_bindings: {},
      },
    };
    const projectIds: Record<string, string> = {
      'team/repo-a': '44444444-4444-4444-8444-444444444410',
      'team/repo-b': '44444444-4444-4444-8444-444444444411',
      'team/repo-c': '44444444-4444-4444-8444-444444444412',
    };
    const upsertProjectFromConnector = vi.fn(async ({ collectionId }: { collectionId: string }) => ({
      projectId: projectIds[collectionId] ?? '44444444-4444-4444-8444-444444444499',
      slug: collectionId.replace('/', '-'),
      name: collectionId,
      memoryId: `memory-for-${collectionId}`,
      collectionId,
    }));
    const gateway = {
      deadLetterStaleJobs: vi.fn(async () => ({ deadLettered: 0 })),
      listOutboxPending: vi.fn(async () => ({ count: 0 })),
      enqueueConnectorSync: vi.fn(async () => ({
        count: 1,
        enqueued: [
          {
            connectionId: 'conn-discover',
            connectorId: 'fake-discover',
            displayName: 'Fixture discover connector',
            jobId: 'job-discover',
          },
        ],
      })),
      getConnection: vi.fn(async () => ({
        id: 'conn-discover',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        connectorId: 'fake-discover',
        displayName: 'Fixture discover connector',
        status: 'connected',
        scopes: [],
        lastSyncAt: null,
        lastError: null,
        metadata: metadataState,
      })),
      getConnectorCursor: vi.fn(async () => null),
      refreshConnectionCollections: vi.fn(async ({ items, projectBindings }: {
        items: unknown[];
        projectBindings?: Record<string, string>;
      }) => {
        const currentCollections = (metadataState.collections ?? {}) as Record<string, unknown>;
        metadataState = {
          ...metadataState,
          collections: {
            selection_mode: 'all',
            excluded_ids: currentCollections.excluded_ids ?? [],
            items,
            project_bindings: {
              ...((currentCollections.project_bindings ?? {}) as Record<string, string>),
              ...(projectBindings ?? {}),
            },
          },
        };
        return { metadata: metadataState };
      }),
      mergeConnectionProjectBindings: vi.fn(async ({ projectBindings }: {
        projectBindings: Record<string, string>;
      }) => {
        const currentCollections = (metadataState.collections ?? {}) as Record<string, unknown>;
        metadataState = {
          ...metadataState,
          collections: {
            selection_mode: 'all',
            excluded_ids: currentCollections.excluded_ids ?? [],
            items: currentCollections.items ?? [],
            project_bindings: {
              ...((currentCollections.project_bindings ?? {}) as Record<string, string>),
              ...projectBindings,
            },
          },
        };
        return { metadata: metadataState };
      }),
      upsertProjectFromConnector,
      captureText: vi.fn(async () => ({ process: null })),
      upsertConnectorCursor: vi.fn(async () => null),
      completeConnectorSync: vi.fn(async ({ jobId, status }: { jobId: string; status: string }) => ({
        jobId,
        status,
        connectionId: 'conn-discover',
      })),
    };

    await planConnectorSync({
      gateway: gateway as any,
      subjectId: '33333333-3333-4333-8333-333333333301',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      connectorRegistry,
    });
    expect(upsertProjectFromConnector).toHaveBeenCalledTimes(1);

    await planConnectorSync({
      gateway: gateway as any,
      subjectId: '33333333-3333-4333-8333-333333333301',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      connectorRegistry,
    });

    const syncedCollections = upsertProjectFromConnector.mock.calls.map(
      ([input]) => input.collectionId,
    );
    expect(syncedCollections).toContain('team/repo-c');
    expect(syncedCollections).not.toContain('team/repo-b');
  });
});
