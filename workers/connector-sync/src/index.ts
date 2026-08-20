import { appleBridgeConnector } from '@memory-os/connector-apple-bridge';
import { githubConnector } from '@memory-os/connector-github';
import { gmailConnector } from '@memory-os/connector-gmail';
import { googleCalendarConnector } from '@memory-os/connector-google-calendar';
import { googleDriveConnector } from '@memory-os/connector-google-drive';
import {
  createConfiguredVaultStore,
  createMemoryOsClient,
  loadMemoryOsEnv,
  SupabaseMemoryGateway,
} from '@memory-os/db';
import { embedMemoryText } from '@memory-os/retrieval';
import {
  classifyConnectorError,
  ConnectorRegistry,
  createConnectorRegistry,
  runConnectorDiscover,
  runConnectorSync,
  resolveConnectorSyncOutcome,
  type ConnectorCollection,
  type RegisteredConnector,
  type SyncCursor,
  type VaultStore,
} from '@memory-os/connector-sdk';
import {
  connectionCollectionExclusionSet,
  connectionCollectionItems,
  normalizeConnectionMetadata,
  selectedConnectionCollections,
} from '@memory-os/schemas';

export const packageName = 'worker-connector-sync' as const;

const WORKSPACE_ID =
  process.env.MEMORY_OS_WORKSPACE_ID ??
  '11111111-1111-4111-8111-111111111111';
const OWNER_ID =
  process.env.MEMORY_OS_OWNER_SUBJECT_ID ??
  '33333333-3333-4333-8333-333333333301';

const defaultSdkConnectorRegistry = createConnectorRegistry([
  appleBridgeConnector,
  githubConnector,
  gmailConnector,
  googleDriveConnector,
  googleCalendarConnector,
]);

export type SyncPlanItem = {
  connectionId: string;
  connectorId: string;
  displayName?: string;
  vaultRef?: string | null;
  jobId?: string;
  eventId?: string;
};

export type SyncPlan = {
  count: number;
  enqueued: SyncPlanItem[];
  captured: number;
  completed: Array<{ jobId: string; status: string; connectionId: string | null }>;
  pendingOutbox: number;
  deadLettered: number;
};

function collectionDisplayName(collection: ConnectorCollection): string {
  const fullName = collection.metadata?.full_name;
  return typeof fullName === 'string' && fullName.trim().length > 0
    ? fullName
    : (collection.title ?? collection.name);
}

function resolveCollectionProjectId(
  metadata: Record<string, unknown> | undefined,
  collectionId: string | undefined,
): string | null {
  const normalized = normalizeConnectionMetadata(metadata);
  if (!collectionId) return null;
  return normalized.collections?.project_bindings?.[collectionId] ?? null;
}

function resolveRecordProjectId(
  metadata: Record<string, unknown> | undefined,
  record: {
    externalObject: { collectionId?: string };
    envelope: { scope?: { project_id?: string } };
  },
): string | null {
  const boundProjectId = resolveCollectionProjectId(metadata, record.externalObject.collectionId);
  if (boundProjectId) return boundProjectId;
  return typeof record.envelope.scope?.project_id === 'string'
    ? record.envelope.scope.project_id
    : null;
}

async function discoverAndSeedConnectionProjects(
  gateway: SupabaseMemoryGateway,
  subjectId: string,
  workspaceId: string,
  item: {
    id: string;
    connectorId: string;
    displayName?: string;
    vaultRef?: string | null;
    scopes?: string[];
    metadata?: Record<string, unknown>;
  },
  vault: VaultStore,
  connector: RegisteredConnector<any>,
) {
  if (typeof connector.lifecycle.discover !== 'function') {
    return item;
  }

  const discovered = await runConnectorDiscover({
    connector,
    context: {
      account: {
        connectionId: item.id,
        connectorId: item.connectorId,
        displayName: item.displayName ?? item.connectorId,
        vaultRef: item.vaultRef ?? undefined,
        scopes: item.scopes ?? [],
        metadata: item.metadata,
      },
      workspaceId,
      vault,
    },
  });

  if (!discovered) return item;

  const refreshed = await gateway.refreshConnectionCollections({
    subjectId,
    connectionId: item.id,
    items: discovered.collections,
  });
  const excludedIds = connectionCollectionExclusionSet(refreshed.metadata);
  const projectBindings: Record<string, string> = {};
  for (const collection of connectionCollectionItems(refreshed.metadata)) {
    if (excludedIds.has(collection.id)) continue;
    const project = await gateway.upsertProjectFromConnector({
      subjectId,
      workspaceId,
      provider: item.connectorId,
      connectionId: item.id,
      collectionId: collection.id,
      externalId: collection.external_id ?? null,
      name: collectionDisplayName(collection),
      url: collection.url ?? null,
      description: collection.description ?? null,
      defaultBranch: collection.default_branch ?? null,
      metadata: collection.metadata,
    });
    projectBindings[collection.id] = project.projectId;
  }

  if (Object.keys(projectBindings).length === 0) {
    return gateway.getConnection(subjectId, item.id);
  }

  await gateway.mergeConnectionProjectBindings({
    subjectId,
    connectionId: item.id,
    projectBindings,
  });
  return gateway.getConnection(subjectId, item.id);
}

function requireGateway(
  gateway?: SupabaseMemoryGateway,
): SupabaseMemoryGateway {
  if (gateway) return gateway;
  const env = loadMemoryOsEnv();
  if (!env) {
    throw new Error(
      'Missing MEMORY_OS_SUPABASE_URL / ANON_KEY / API_SECRET for connector-sync',
    );
  }
  return new SupabaseMemoryGateway(createMemoryOsClient(env), env.apiSecret);
}

function toSyncCursor(
  row:
    | {
        stream: string;
        cursor: Record<string, unknown>;
        schemaVersion: string;
        updatedAt: string;
      }
    | null,
): SyncCursor | null {
  if (!row) return null;
  return {
    stream: row.stream,
    opaque: row.cursor,
    schemaVersion: row.schemaVersion,
    updatedAt: row.updatedAt,
  };
}

async function ingestSdkConnectorDelta(
  gateway: SupabaseMemoryGateway,
  subjectId: string,
  workspaceId: string,
  item: SyncPlanItem,
  vault: VaultStore,
  connector: RegisteredConnector<any>,
) {
  const connection = await gateway.getConnection(subjectId, item.connectionId);
  const syncedConnection = await discoverAndSeedConnectionProjects(
    gateway,
    subjectId,
    workspaceId,
    {
      id: connection.id,
      connectorId: connection.connectorId,
      displayName: connection.displayName,
      vaultRef: connection.vaultRef ?? undefined,
      scopes: connection.scopes ?? [],
      metadata: connection.metadata,
    },
    vault,
    connector,
  );
  const stream = connector.manifest.default_stream ?? connector.manifest.id;
  const cursor = toSyncCursor(
    await gateway.getConnectorCursor({
      subjectId,
      accountId: syncedConnection.id,
      stream,
    }),
  );
  const syncRun = await runConnectorSync({
    connector,
    context: {
      account: {
        connectionId: syncedConnection.id,
        connectorId: syncedConnection.connectorId,
        displayName: syncedConnection.displayName ?? syncedConnection.connectorId,
        vaultRef: syncedConnection.vaultRef ?? undefined,
        scopes: syncedConnection.scopes ?? [],
        metadata: syncedConnection.metadata,
      },
      workspaceId,
      vault,
      cursor,
    },
  });
  let captured = 0;
  let tombstoned = 0;
  let skippedWithoutProject = 0;
  for (const record of syncRun.records) {
    const projectId = resolveRecordProjectId(syncedConnection.metadata, record);
    if (record.externalObject.deleted) {
      await gateway.tombstoneConnectorObject({
        subjectId,
        workspaceId,
        projectId,
        provider: record.externalObject.provider,
        accountId: record.externalObject.accountId,
        externalId: record.externalObject.externalId,
        eventType: record.envelope.event_type,
        observedAt: record.envelope.observed_at,
        idempotencyKey: record.envelope.idempotency_key,
        reason:
          typeof record.externalObject.permissionsSnapshot.reason === 'string'
            ? record.externalObject.permissionsSnapshot.reason
            : String(record.envelope.provenance.changeState ?? 'connector object removed'),
        provenance: record.envelope.provenance,
        metadata: record.externalObject.metadata,
      });
      tombstoned += 1;
      continue;
    }
    if (!projectId) {
      skippedWithoutProject += 1;
      continue;
    }
    const captureResult = await gateway.captureConnectorRecord({
      subjectId,
      workspaceId,
      projectId,
      provider: record.externalObject.provider,
      accountId: record.externalObject.accountId,
      externalId: record.externalObject.externalId,
      externalVersion: record.externalObject.externalVersion ?? null,
      eventType: record.envelope.event_type,
      title: record.capture.title,
      text: record.capture.text,
      idempotencyKey: record.envelope.idempotency_key,
      sensitivity: record.envelope.scope.sensitivity,
      storageMode: record.envelope.scope.storage_mode,
      observedAt: record.envelope.observed_at,
      filename: record.capture.filename,
      mimeType: record.capture.mimeType,
      canonicalReference: record.externalObject.canonicalReference,
      provenance: record.envelope.provenance,
      metadata: record.externalObject.metadata,
      processNow: true,
    });
    await maybeEmbed(gateway, subjectId, record.capture.title, record.capture.text, captureResult);
    captured += 1;
  }
  if (syncRun.nextCursor) {
    await gateway.upsertConnectorCursor({
      subjectId,
      accountId: syncedConnection.id,
      stream: syncRun.nextCursor.stream,
      cursor: syncRun.nextCursor.opaque,
      schemaVersion: syncRun.nextCursor.schemaVersion,
    });
  }
  return {
    captured,
    pullMode: syncRun.page.pullMode ?? 'stub',
    note: [
      syncRun.page.note ?? `${syncRun.manifest.id} connector sync completed`,
      tombstoned > 0 ? `tombstoned ${tombstoned}` : null,
      skippedWithoutProject > 0 ? `skipped ${skippedWithoutProject} without project binding` : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join('; '),
  };
}

async function maybeEmbed(
  gateway: SupabaseMemoryGateway,
  subjectId: string,
  title: string,
  text: string,
  captureResult: { process?: { memoryId?: string | null } | null },
) {
  const memoryId = captureResult.process?.memoryId;
  if (!memoryId) return;
  try {
    const embedded = await embedMemoryText(title, text);
    if (embedded.vector.length === 0) return;
    await gateway.setMemoryEmbedding({
      subjectId,
      memoryId,
      embedding: embedded.vector,
      engine: embedded.engine,
    });
  } catch (err) {
    const strict =
      (process.env.MEMORY_OS_EMBED_STRICT ?? '').trim() === '1' ||
      (process.env.MEMORY_OS_EMBED_STRICT ?? '').trim().toLowerCase() === 'true';
    if (strict) throw err;
    // ingest should not fail solely because embedding failed (non-strict)
  }
}

async function ingestConnectorDelta(
  gateway: SupabaseMemoryGateway,
  subjectId: string,
  workspaceId: string,
  item: SyncPlanItem,
  vault: VaultStore,
  connectorRegistry: ConnectorRegistry,
): Promise<{ captured: number; pullMode: string; note: string }> {
  const sdkConnector = connectorRegistry.get(item.connectorId);
  if (sdkConnector) {
    return ingestSdkConnectorDelta(
      gateway,
      subjectId,
      workspaceId,
      item,
      vault,
      sdkConnector,
    );
  }
  return { captured: 0, pullMode: 'none', note: 'unsupported connector' };
}

type ClaimedConnectorSyncJob = {
  jobId: string;
  workspaceId: string;
  status: string;
  attempt: number;
  error: string | null;
  idempotencyKey: string;
  connectionId: string;
  connectorId: string;
  displayName?: string;
  vaultRef?: string | null;
};

export async function planConnectorSync(options?: {
  workspaceId?: string;
  subjectId?: string;
  connectionId?: string | null;
  gateway?: SupabaseMemoryGateway;
  ingest?: boolean;
  connectorRegistry?: ConnectorRegistry;
}): Promise<SyncPlan> {
  const gateway = requireGateway(options?.gateway);
  const subjectId = options?.subjectId ?? OWNER_ID;
  const workspaceId = options?.workspaceId ?? WORKSPACE_ID;
  const connectorRegistry = options?.connectorRegistry ?? defaultSdkConnectorRegistry;
  const stale = await gateway.deadLetterStaleJobs({
    subjectId,
    workspaceId,
    olderThanMinutes: Number(process.env.MEMORY_OS_JOB_STALE_MINUTES ?? 60),
  });
  const pending = await gateway.listOutboxPending({
    subjectId,
    workspaceId,
    eventType: 'connector.sync.requested',
    limit: 20,
  });
  const result = await gateway.enqueueConnectorSync({
    subjectId,
    workspaceId,
    connectionId: options?.connectionId ?? null,
  });
  const claimed = await gateway.claimConnectorSyncJobs({
    subjectId,
    workspaceId,
    connectionId: options?.connectionId ?? null,
    limit: Number(process.env.MEMORY_OS_CONNECTOR_SYNC_CLAIM_LIMIT ?? 20),
    retryBaseMs: Number(process.env.MEMORY_OS_CONNECTOR_SYNC_RETRY_BASE_MS ?? 30_000),
    retryMaxMs: Number(process.env.MEMORY_OS_CONNECTOR_SYNC_RETRY_MAX_MS ?? 300_000),
  });
  const maxAttempts = Math.max(
    1,
    Number(process.env.MEMORY_OS_CONNECTOR_SYNC_MAX_ATTEMPTS ?? 3),
  );

  const completed: SyncPlan['completed'] = [];
  let captured = 0;
  const ingest = options?.ingest !== false;
  const vault = createConfiguredVaultStore({ gateway });

  for (const item of claimed.jobs as ClaimedConnectorSyncJob[]) {
    try {
      let pullMode = 'stub';
      let note = 'connector delta ingested';
      if (ingest) {
        const syncItem: SyncPlanItem = {
          connectionId: item.connectionId,
          connectorId: item.connectorId,
          displayName: item.displayName,
          vaultRef: item.vaultRef ?? undefined,
          jobId: item.jobId,
        };
        const ingested = await ingestConnectorDelta(
          gateway,
          subjectId,
          workspaceId,
          syncItem,
          vault,
          connectorRegistry,
        );
        captured += ingested.captured;
        pullMode = ingested.pullMode;
        note = ingested.note;
      }
      const outcome = ingest
        ? resolveConnectorSyncOutcome({ pullMode, note })
        : { status: 'succeeded' as const, error: null };
      const done = await gateway.completeConnectorSync({
        subjectId,
        jobId: item.jobId,
        status: outcome.status,
        error: outcome.error,
      });
      completed.push({
        jobId: done.jobId,
        status: done.status,
        connectionId: done.connectionId,
      });
      console.log(
        JSON.stringify({
          event: 'connector_sync_completed',
          connectorId: item.connectorId,
          ...done,
          pullMode,
          note,
          outcome: outcome.status,
        }),
      );
    } catch (err) {
      const classified = classifyConnectorError(err);
      if (classified.retryable) {
        if (item.attempt + 1 >= maxAttempts) {
          const done = await gateway.completeConnectorSync({
            subjectId,
            jobId: item.jobId,
            status: 'dead_letter',
            error: classified.message,
          });
          completed.push({
            jobId: done.jobId,
            status: done.status,
            connectionId: done.connectionId,
          });
        } else {
          const queued = await gateway.retryConnectorSync({
            subjectId,
            jobId: item.jobId,
            error: classified.message,
          });
          completed.push({
            jobId: queued.jobId,
            status: queued.status,
            connectionId: queued.connectionId,
          });
        }
      } else {
        const done = await gateway.completeConnectorSync({
          subjectId,
          jobId: item.jobId,
          status: 'failed',
          error: classified.message,
        });
        completed.push({
          jobId: done.jobId,
          status: done.status,
          connectionId: done.connectionId,
        });
      }
    }
  }

  return {
    count: result.count ?? 0,
    enqueued: result.enqueued ?? [],
    captured,
    completed,
    pendingOutbox: pending.count,
    deadLettered: stale.deadLettered,
  };
}

/** One-shot tick used by CLI / cron. */
export async function runConnectorSyncOnce(): Promise<SyncPlan> {
  return planConnectorSync();
}

export function parseWorkerIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.MEMORY_OS_WORKER_INTERVAL_MS?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) {
    throw new Error('MEMORY_OS_WORKER_INTERVAL_MS must be >= 1000');
  }
  return n;
}

export async function startConnectorSyncLoop(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const intervalMs = parseWorkerIntervalMs(env);
  const tick = async () => {
    const plan = await runConnectorSyncOnce();
    console.log(JSON.stringify({ ok: true, ...plan }));
  };
  await tick();
  if (intervalMs == null) return;
  console.log(
    JSON.stringify({
      ok: true,
      mode: 'loop',
      intervalMs,
      worker: 'connector-sync',
    }),
  );
  setInterval(() => {
    void tick().catch((err: Error) => {
      console.error(err.message);
    });
  }, intervalMs);
}

const isDirectRun = process.argv[1]?.includes('connector-sync');
if (isDirectRun) {
  void startConnectorSyncLoop()
    .then(() => {
      if (!parseWorkerIntervalMs()) process.exit(0);
    })
    .catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
}
