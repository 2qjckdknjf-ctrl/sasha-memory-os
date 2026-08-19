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
  normalizeConnectionMetadata,
  selectedConnectionCollections,
} from '@memory-os/schemas';

export const packageName = 'worker-connector-sync' as const;

const WORKSPACE_ID =
  process.env.MEMORY_OS_WORKSPACE_ID ??
  '11111111-1111-4111-8111-111111111111';
const PROJECT_ID =
  process.env.MEMORY_OS_PROJECT_ID ??
  '44444444-4444-4444-8444-444444444401';
const OWNER_ID =
  process.env.MEMORY_OS_OWNER_SUBJECT_ID ??
  '33333333-3333-4333-8333-333333333301';

const defaultSdkConnectorRegistry = createConnectorRegistry([
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
  const projectBindings: Record<string, string> = {};
  for (const collection of selectedConnectionCollections(refreshed.metadata)) {
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
  for (const record of syncRun.records) {
    const projectId =
      resolveCollectionProjectId(
        syncedConnection.metadata,
        record.externalObject.collectionId,
      ) ?? null;
    const captureResult = await gateway.captureText({
      subjectId,
      workspaceId,
      projectId,
      title: record.capture.title,
      text: record.capture.text,
      idempotencyKey: record.capture.idempotencyKey,
      processNow: true,
      filename: record.capture.filename,
      mimeType: record.capture.mimeType,
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
    note: syncRun.page.note ?? `${syncRun.manifest.id} connector sync completed`,
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

  const completed: SyncPlan['completed'] = [];
  let captured = 0;
  const ingest = options?.ingest !== false;
  const vault = createConfiguredVaultStore({ gateway });

  for (const item of result.enqueued ?? []) {
    if (!item.jobId) continue;
    try {
      let pullMode = 'stub';
      let note = 'connector delta ingested';
      if (ingest) {
        const ingested = await ingestConnectorDelta(
          gateway,
          subjectId,
          workspaceId,
          item,
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
      const message = err instanceof Error ? err.message : String(err);
      const done = await gateway.completeConnectorSync({
        subjectId,
        jobId: item.jobId,
        status: 'failed',
        error: message,
      });
      completed.push({
        jobId: done.jobId,
        status: done.status,
        connectionId: done.connectionId,
      });
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
