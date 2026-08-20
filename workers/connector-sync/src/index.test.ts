import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDefaultCursor,
  connectorRateLimitError,
  createConnectorRegistry,
  resolveConnectorSyncOutcome,
} from '@memory-os/connector-sdk';
import { parseWorkerIntervalMs, planConnectorSync } from './index.js';

const owner = '33333333-3333-4333-8333-333333333301';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const fixtureProjectId = '44444444-4444-4444-8444-444444444401';
const registryConnectionId = '88888888-8888-4888-8888-888888888801';
const discoverConnectionId = '88888888-8888-4888-8888-888888888802';
const retryConnectionId = '88888888-8888-4888-8888-888888888803';
const resyncConnectionId = '88888888-8888-4888-8888-888888888804';

function buildFixtureRecord(
  connectionId: string,
  workspaceId: string,
  rawObject: { externalId: string; title: string; observedAt: string },
) {
  return {
    externalObject: {
      provider: 'fixture',
      accountId: connectionId,
      collectionId: 'fixture',
      externalId: rawObject.externalId,
      objectType: 'fixture',
      title: rawObject.title,
      createdAt: rawObject.observedAt,
      modifiedAt: rawObject.observedAt,
      deleted: false,
      attachments: [],
      permissionsSnapshot: {},
      metadata: {},
    },
    envelope: {
      schema_version: '1.0' as const,
      workspace_id: workspaceId,
      source: {
        provider: 'fixture',
        account_id: connectionId,
        external_id: rawObject.externalId,
      },
      event_type: 'fixture.record',
      observed_at: rawObject.observedAt,
      idempotency_key: `connector-sync/${connectionId}/${rawObject.externalId}`,
      content: {
        mime_type: 'text/plain',
        text: rawObject.title,
      },
      scope: {
        project_id: fixtureProjectId,
        sensitivity: 'internal' as const,
        storage_mode: 'reference' as const,
      },
      provenance: {
        sourceMode: 'stub',
      },
    },
    capture: {
      title: rawObject.title,
      text: rawObject.title,
      filename: `fixture://${rawObject.externalId}`,
      mimeType: 'text/plain',
      idempotencyKey: `connector-sync/${connectionId}/${rawObject.externalId}`,
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

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
    expect(parseWorkerIntervalMs({ MEMORY_OS_WORKER_INTERVAL_MS: '60000' })).toBe(60000);
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
            return buildFixtureRecord(context.account.connectionId, context.workspaceId, context.rawObject);
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
            connectionId: registryConnectionId,
            connectorId: 'fake-registry',
            displayName: 'Fixture connector',
            jobId: 'job-1',
          },
        ],
      })),
      claimConnectorSyncJobs: vi.fn(async () => ({
        count: 1,
        jobs: [
          {
            jobId: 'job-1',
            workspaceId,
            status: 'running',
            attempt: 0,
            error: null,
            idempotencyKey: `connector-sync/${registryConnectionId}/job-1`,
            connectionId: registryConnectionId,
            connectorId: 'fake-registry',
            displayName: 'Fixture connector',
            vaultRef: null,
          },
        ],
      })),
      getConnection: vi.fn(async () => ({
        id: registryConnectionId,
        workspaceId,
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
      captureConnectorRecord: vi.fn(async () => ({ process: null })),
      tombstoneConnectorObject: vi.fn(async () => ({ affectedCount: 0 })),
      upsertConnectorCursor: vi.fn(async () => null),
      completeConnectorSync: vi.fn(async ({ jobId, status }: { jobId: string; status: string }) => ({
        jobId,
        status,
        connectionId: registryConnectionId,
      })),
      retryConnectorSync: vi.fn(),
    };

    const plan = await planConnectorSync({
      gateway: gateway as any,
      subjectId: owner,
      workspaceId,
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
            connectionId: discoverConnectionId,
            connectorId: 'fake-discover',
            displayName: 'Fixture discover connector',
            jobId: 'job-discover',
          },
        ],
      })),
      claimConnectorSyncJobs: vi.fn(async () => ({
        count: 1,
        jobs: [
          {
            jobId: 'job-discover',
            workspaceId,
            status: 'running',
            attempt: 0,
            error: null,
            idempotencyKey: `connector-sync/${discoverConnectionId}/job-discover`,
            connectionId: discoverConnectionId,
            connectorId: 'fake-discover',
            displayName: 'Fixture discover connector',
            vaultRef: null,
          },
        ],
      })),
      getConnection: vi.fn(async () => ({
        id: discoverConnectionId,
        workspaceId,
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
      captureConnectorRecord: vi.fn(async () => ({ process: null })),
      tombstoneConnectorObject: vi.fn(async () => ({ affectedCount: 0 })),
      upsertConnectorCursor: vi.fn(async () => null),
      completeConnectorSync: vi.fn(async ({ jobId, status }: { jobId: string; status: string }) => ({
        jobId,
        status,
        connectionId: discoverConnectionId,
      })),
      retryConnectorSync: vi.fn(),
    };

    await planConnectorSync({
      gateway: gateway as any,
      subjectId: owner,
      workspaceId,
      connectorRegistry,
    });
    expect(upsertProjectFromConnector).toHaveBeenCalledTimes(1);

    await planConnectorSync({
      gateway: gateway as any,
      subjectId: owner,
      workspaceId,
      connectorRegistry,
    });

    const syncedCollections = upsertProjectFromConnector.mock.calls.map(([input]) => input.collectionId);
    expect(syncedCollections).toContain('team/repo-c');
    expect(syncedCollections).not.toContain('team/repo-b');
  });

  it('retries, dead-letters, and replays retryable connector jobs', async () => {
    vi.stubEnv('MEMORY_OS_CONNECTOR_SYNC_MAX_ATTEMPTS', '2');
    vi.stubEnv('MEMORY_OS_CONNECTOR_PULL_MODE', 'auto');

    let syncAttempts = 0;
    let jobStatus: 'queued' | 'dead_letter' | 'succeeded' = 'queued';
    let jobAttempt = 0;
    let connectionStatus: 'connected' | 'degraded' = 'connected';
    const connectorRegistry = createConnectorRegistry([
      {
        manifest: {
          id: 'retryable',
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
            syncAttempts += 1;
            if (syncAttempts < 3) {
              throw connectorRateLimitError({
                message: 'Synthetic 429',
                retryAfterMs: 60_000,
              });
            }
            return {
              stream: 'retryable:stream',
              mode: 'initial' as const,
              pullMode: 'stub',
              rawObjects: [
                {
                  externalId: 'fixture/replay',
                  title: 'Recovered after replay',
                  observedAt: '2026-08-11T10:00:00.000Z',
                },
              ],
            };
          },
          async normalize(context) {
            return buildFixtureRecord(context.account.connectionId, context.workspaceId, context.rawObject);
          },
        },
      },
    ]);

    const captureConnectorRecord = vi.fn(async () => ({ process: null }));
    const gateway = {
      deadLetterStaleJobs: vi.fn(async () => ({ deadLettered: 0 })),
      listOutboxPending: vi.fn(async () => ({ count: 0 })),
      enqueueConnectorSync: vi.fn(async () => ({
        count: 0,
        enqueued: [],
      })),
      claimConnectorSyncJobs: vi.fn(async () => ({
        count: jobStatus === 'queued' && connectionStatus === 'connected' ? 1 : 0,
        jobs:
          jobStatus === 'queued' && connectionStatus === 'connected'
            ? [
                {
                  jobId: 'job-retry',
                  workspaceId,
                  status: 'running',
                  attempt: jobAttempt,
                  error: null,
                  idempotencyKey: `connector-sync/${retryConnectionId}/job-retry`,
                  connectionId: retryConnectionId,
                  connectorId: 'retryable',
                  displayName: 'Retryable connector',
                  vaultRef: null,
                },
              ]
            : [],
      })),
      getConnection: vi.fn(async () => ({
        id: retryConnectionId,
        workspaceId,
        connectorId: 'retryable',
        displayName: 'Retryable connector',
        status: connectionStatus,
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
      captureConnectorRecord,
      tombstoneConnectorObject: vi.fn(async () => ({ affectedCount: 0 })),
      upsertConnectorCursor: vi.fn(async () => null),
      completeConnectorSync: vi.fn(async ({ jobId, status }: { jobId: string; status: string }) => {
        jobStatus = status === 'succeeded' ? 'succeeded' : 'dead_letter';
        jobAttempt += 1;
        connectionStatus = status === 'succeeded' ? 'connected' : 'degraded';
        return {
          jobId,
          status,
          connectionId: retryConnectionId,
        };
      }),
      retryConnectorSync: vi.fn(async ({ jobId }: { jobId: string }) => {
        jobStatus = 'queued';
        jobAttempt += 1;
        return {
          jobId,
          status: 'queued',
          attempt: jobAttempt,
          connectionId: retryConnectionId,
          jobType: 'connector_sync',
          error: 'Synthetic 429',
        };
      }),
      replayConnectorSync: vi.fn(async ({ jobId }: { subjectId: string; jobId: string; resync: boolean }) => {
        jobStatus = 'queued';
        connectionStatus = 'connected';
        return {
          jobId,
          status: 'queued',
          attempt: jobAttempt,
          connectionId: retryConnectionId,
          jobType: 'connector_sync',
          resync: false,
          clearedCursorCount: 0,
        };
      }),
    };

    const first = await planConnectorSync({
      gateway: gateway as any,
      subjectId: owner,
      workspaceId,
      connectorRegistry,
    });
    expect(first.completed[0]?.status).toBe('queued');
    expect(gateway.retryConnectorSync).toHaveBeenCalledTimes(1);

    const second = await planConnectorSync({
      gateway: gateway as any,
      subjectId: owner,
      workspaceId,
      connectorRegistry,
    });
    expect(second.completed[0]?.status).toBe('dead_letter');
    expect(gateway.completeConnectorSync).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-retry',
        status: 'dead_letter',
      }),
    );

    const blocked = await planConnectorSync({
      gateway: gateway as any,
      subjectId: owner,
      workspaceId,
      connectorRegistry,
    });
    expect(blocked.completed).toHaveLength(0);

    await gateway.replayConnectorSync({ subjectId: owner, jobId: 'job-retry', resync: false });
    const third = await planConnectorSync({
      gateway: gateway as any,
      subjectId: owner,
      workspaceId,
      connectorRegistry,
    });
    expect(third.completed[0]?.status).toBe('succeeded');
    expect(captureConnectorRecord).toHaveBeenCalledTimes(1);
  });

  it('re-runs an initial sync after operator resync clears the cursor', async () => {
    let initialSyncCalled = 0;
    let incrementalSyncCalled = 0;
    let cursorState: {
      stream: string;
      cursor: Record<string, unknown>;
      schemaVersion: string;
      updatedAt: string;
    } | null = {
      stream: 'resyncable:stream',
      cursor: {
        lastSeenExternalId: 'fixture/old',
      },
      schemaVersion: '1.0',
      updatedAt: '2026-08-11T09:00:00.000Z',
    };
    let queueClaimed = true;

    const connectorRegistry = createConnectorRegistry([
      {
        manifest: {
          id: 'resyncable',
          version: '1.0.0',
          sdk_version: '^1.0',
          auth: 'oauth2',
          supports: {
            discover: false,
            validate_scope: false,
            initial_sync: true,
            incremental_sync: true,
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
            initialSyncCalled += 1;
            return {
              stream: 'resyncable:stream',
              mode: 'initial' as const,
              pullMode: 'stub',
              rawObjects: [
                {
                  externalId: 'fixture/new',
                  title: 'Full resync',
                  observedAt: '2026-08-11T11:00:00.000Z',
                },
              ],
            };
          },
          async incrementalSync() {
            incrementalSyncCalled += 1;
            return {
              stream: 'resyncable:stream',
              mode: 'incremental' as const,
              pullMode: 'stub',
              rawObjects: [],
            };
          },
          async normalize(context) {
            return buildFixtureRecord(context.account.connectionId, context.workspaceId, context.rawObject);
          },
          async checkpoint() {
            return buildDefaultCursor('resyncable:stream', {
              lastSeenExternalId: 'fixture/new',
            });
          },
        },
      },
    ]);

    const gateway = {
      deadLetterStaleJobs: vi.fn(async () => ({ deadLettered: 0 })),
      listOutboxPending: vi.fn(async () => ({ count: 0 })),
      enqueueConnectorSync: vi.fn(async () => ({
        count: 0,
        enqueued: [],
      })),
      claimConnectorSyncJobs: vi.fn(async () => ({
        count: queueClaimed ? 1 : 0,
        jobs:
          queueClaimed
            ? [
                {
                  jobId: 'job-resync',
                  workspaceId,
                  status: 'running',
                  attempt: 0,
                  error: null,
                  idempotencyKey: `connector-sync/${resyncConnectionId}/job-resync`,
                  connectionId: resyncConnectionId,
                  connectorId: 'resyncable',
                  displayName: 'Resyncable connector',
                  vaultRef: null,
                },
              ]
            : [],
      })),
      getConnection: vi.fn(async () => ({
        id: resyncConnectionId,
        workspaceId,
        connectorId: 'resyncable',
        displayName: 'Resyncable connector',
        status: 'connected',
        scopes: [],
        lastSyncAt: null,
        lastError: null,
        metadata: {},
      })),
      getConnectorCursor: vi.fn(async () => cursorState),
      refreshConnectionCollections: vi.fn(async () => ({ metadata: {} })),
      mergeConnectionProjectBindings: vi.fn(async () => ({ metadata: {} })),
      upsertProjectFromConnector: vi.fn(async () => ({
        projectId: '44444444-4444-4444-8444-444444444401',
        slug: 'fixture',
        name: 'Fixture',
        memoryId: '66666666-6666-4666-8666-666666666601',
        collectionId: 'fixture',
      })),
      captureConnectorRecord: vi.fn(async () => ({ process: null })),
      tombstoneConnectorObject: vi.fn(async () => ({ affectedCount: 0 })),
      upsertConnectorCursor: vi.fn(async () => null),
      completeConnectorSync: vi.fn(async ({ jobId, status }: { jobId: string; status: string }) => ({
        jobId,
        status,
        connectionId: resyncConnectionId,
      })),
      retryConnectorSync: vi.fn(),
      resyncConnector: vi.fn(async (_input: { subjectId: string; workspaceId: string; connectionId: string }) => {
        cursorState = null;
        queueClaimed = true;
        return {
          jobId: 'job-resync',
          eventId: 'event-resync',
          connectionId: resyncConnectionId,
          connectorId: 'resyncable',
          clearedCursorCount: 1,
          idempotencyKey: `connector-sync/${resyncConnectionId}/resync/1`,
        };
      }),
    };

    await planConnectorSync({
      gateway: gateway as any,
      subjectId: owner,
      workspaceId,
      connectorRegistry,
    });
    expect(incrementalSyncCalled).toBe(1);
    expect(initialSyncCalled).toBe(0);

    await gateway.resyncConnector({
      subjectId: owner,
      workspaceId,
      connectionId: resyncConnectionId,
    });
    await planConnectorSync({
      gateway: gateway as any,
      subjectId: owner,
      workspaceId,
      connectorRegistry,
    });

    expect(initialSyncCalled).toBe(1);
  });
});
