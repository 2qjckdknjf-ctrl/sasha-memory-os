import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  authorize,
  resolveLocalSubject,
  type AclEntry,
  type AuthzContext,
} from '@memory-os/authz';
import {
  createSeededStore,
  type MemoryRecord,
  type MemoryStore,
} from '@memory-os/domain';
import { githubConnector } from '@memory-os/connector-github';
import { gmailConnector } from '@memory-os/connector-gmail';
import { googleCalendarConnector } from '@memory-os/connector-google-calendar';
import { googleDriveConnector } from '@memory-os/connector-google-drive';
import {
  ConnectorRegistry,
  createConnectorRegistry,
  exchangeAuthorizationCode,
  fingerprintAuthorizationCode,
  resolveAuthorizeBase,
  resolveConnectorSyncOutcome,
  runConnectorDiscover,
  runConnectorHealthcheck,
  runConnectorSync,
  type ConnectorCollection,
  type RegisteredConnector,
  type SyncCursor,
} from '@memory-os/connector-sdk';
import {
  applyExtractionSchema,
  bindAuthUserSchema,
  captureDocumentSchema,
  captureLinkSchema,
  connectionCollectionExclusionSet,
  connectionCollectionItems,
  captureTextSchema,
  correctMemorySchema,
  createDecisionSchema,
  createHandoffSchema,
  createPrivacyRequestSchema,
  ingestionEnvelopeSchema,
  normalizeConnectionMetadata,
  oauthCompleteSchema,
  oauthStartSchema,
  replayConnectorJobSchema,
  resyncConnectionSchema,
  revokeConnectionSchema,
  selectedConnectionCollections,
  setConnectionStatusSchema,
  setMemoryStatusSchema,
  upsertConnectionSchema,
  upsertProjectStateSchema,
  updateConnectionSchema,
} from '@memory-os/schemas';
import {
  decodeBase64Document,
  extractTextFromBytes,
  fetchPublicLink,
} from '@memory-os/ingestion';
import {
  createEmbeddingAdapter,
  createExtractionAdapter,
  embedMemoryText,
  packSearchContext,
  planCandidateConsolidations,
  projectContext,
  rerankHitsHybrid,
  searchMemoriesHybrid,
} from '@memory-os/retrieval';
import { createConfiguredVaultStore } from '@memory-os/db';
import {
  createMcpHandlers,
  handleMcpJsonRpc,
  type JsonRpcReq,
} from '@memory-os/mcp-gateway';
import type { SupabaseMemoryGateway } from './supabase.js';
import {
  describeGitHubWebhookAction,
  GITHUB_WEBHOOK_CURSOR_STREAM,
  GITHUB_WEBHOOK_DELIVERY_HEADER,
  GITHUB_WEBHOOK_EVENT_HEADER,
  GITHUB_WEBHOOK_SIGNATURE_HEADER,
  type GitHubWebhookPayload,
  parseGitHubWebhookPayload,
  resolveGitHubWebhookRepositoryCollection,
  verifyGitHubWebhookSignature,
} from './githubWebhook.js';
import { requireHttpApiSecret } from './httpAuth.js';
import { withRequestId } from './requestId.js';

export type ApiVariables = {
  store: MemoryStore;
  authz: AuthzContext;
  gateway: SupabaseMemoryGateway | null;
  requestId: string;
  actor: {
    id: string;
    externalKey?: string;
    displayName?: string;
    kind?: string;
  };
};

const seedWorkspace = '11111111-1111-4111-8111-111111111111';
const seedProject = '44444444-4444-4444-8444-444444444401';
const owner = '33333333-3333-4333-8333-333333333301';
const chatgpt = '33333333-3333-4333-8333-333333333302';
const cursor = '33333333-3333-4333-8333-333333333303';
const roma = '33333333-3333-4333-8333-333333333304';

type LocalAgentDescriptor = {
  purpose?: string;
  allowedTools?: string[];
  capabilities?: string[];
};

const LOCAL_AGENT_DETAILS: Record<string, LocalAgentDescriptor> = {
  [owner]: {
    purpose: 'Владелец рабочей области и политики доступа.',
    capabilities: ['workspace.owner', 'memory.export', 'connections.manage'],
  },
  [chatgpt]: {
    purpose: 'Стратегия, анализ, планирование и запись решений в разрешенной памяти.',
    allowedTools: [
      'memory.search',
      'memory.get',
      'context.project',
      'capture.text',
      'memory.store_decision',
      'handoff.create',
      'memory.set_status',
    ],
    capabilities: ['memory.read', 'memory.write.decision', 'memory.write.summary'],
  },
  [cursor]: {
    purpose: 'Инженерный контекст, repository/project state и handoff без доступа к личным данным.',
    allowedTools: [
      'memory.search',
      'memory.get',
      'context.project',
      'handoff.create',
      'memory.set_status',
    ],
    capabilities: ['memory.read.project', 'session.write', 'handoff.write'],
  },
  [roma]: {
    purpose:
      'Аудит, QA и findings по явно разрешенным проектам без наследования owner-прав.',
    allowedTools: [
      'memory.search',
      'memory.get',
      'context.project',
      'capture.text',
      'handoff.create',
      'memory.set_status',
    ],
    capabilities: ['memory.read.project', 'memory.write.findings', 'qa.read', 'handoff.write'],
  },
};

function seedAuthz(subjectId: string): AuthzContext {
  const isOwner = subjectId === owner;
  return {
    subjectId,
    workspaceId: seedWorkspace,
    isOwner,
    entries: [
      {
        subjectId: chatgpt,
        effect: 'allow',
        resourceType: 'memory',
        projectId: seedProject,
        actions: ['read', 'write'],
        sensitivityMax: 'internal',
      },
      {
        subjectId: chatgpt,
        effect: 'allow',
        resourceType: 'project_state',
        projectId: seedProject,
        actions: ['read', 'write'],
        sensitivityMax: 'internal',
      },
      {
        subjectId: cursor,
        effect: 'allow',
        resourceType: 'memory',
        projectId: seedProject,
        actions: ['read', 'write'],
        sensitivityMax: 'internal',
      },
      {
        subjectId: cursor,
        effect: 'allow',
        resourceType: 'project_state',
        projectId: seedProject,
        actions: ['read', 'write'],
        sensitivityMax: 'internal',
      },
      {
        subjectId: cursor,
        effect: 'allow',
        resourceType: 'handoff',
        projectId: seedProject,
        actions: ['read', 'write'],
        sensitivityMax: 'internal',
      },
      {
        subjectId: roma,
        effect: 'allow',
        resourceType: 'memory',
        projectId: seedProject,
        actions: ['read', 'write'],
        sensitivityMax: 'internal',
      },
      {
        subjectId: roma,
        effect: 'allow',
        resourceType: 'project',
        projectId: seedProject,
        actions: ['read'],
        sensitivityMax: 'internal',
      },
      {
        subjectId: roma,
        effect: 'allow',
        resourceType: 'project_state',
        projectId: seedProject,
        actions: ['read'],
        sensitivityMax: 'internal',
      },
      {
        subjectId: roma,
        effect: 'allow',
        resourceType: 'handoff',
        projectId: seedProject,
        actions: ['read', 'write'],
        sensitivityMax: 'internal',
      },
      {
        subjectId: chatgpt,
        effect: 'allow',
        resourceType: 'memory',
        projectId: null,
        actions: ['read', 'write'],
        sensitivityMax: 'internal',
      },
      {
        subjectId: chatgpt,
        effect: 'allow',
        resourceType: 'handoff',
        projectId: null,
        actions: ['read', 'write'],
        sensitivityMax: 'internal',
      },
      {
        subjectId: cursor,
        effect: 'allow',
        resourceType: 'memory',
        projectId: null,
        actions: ['read', 'write'],
        sensitivityMax: 'internal',
      },
      {
        subjectId: cursor,
        effect: 'allow',
        resourceType: 'handoff',
        projectId: null,
        actions: ['read', 'write'],
        sensitivityMax: 'internal',
      },
    ],
  };
}

function resolveSeedActor(
  subjectId: string | null | undefined,
): {
  id: string;
  externalKey?: string;
  displayName?: string;
  kind?: string;
} | null {
  if (!subjectId) return null;
  return (
    resolveLocalSubject({
      subjectId,
      workspaceId: seedWorkspace,
    }) ?? { id: subjectId }
  );
}

function formatAclScope(entry: AclEntry): string {
  const actions = entry.actions.length > 0 ? entry.actions.join('+') : 'all';
  const sensitivity = entry.sensitivityMax ?? 'all';
  const project = entry.projectId ?? 'workspace';
  return `${entry.resourceType}.${actions}@${project}<=${sensitivity}`;
}

function buildLocalAgentRow(subjectId: string) {
  const actor = resolveSeedActor(subjectId);
  const authz = seedAuthz(subjectId);
  const details = LOCAL_AGENT_DETAILS[subjectId];
  const rights = authz.isOwner
    ? [
        {
          effect: 'allow',
          resourceType: '*',
          projectId: null,
          actions: ['read', 'write'],
          sensitivityMax: null,
          source: 'workspace_owner',
        },
      ]
    : authz.entries
        .filter((entry) => entry.subjectId === subjectId)
        .map((entry) => ({
          effect: entry.effect,
          resourceType: entry.resourceType,
          projectId: entry.projectId,
          actions: entry.actions,
          sensitivityMax: entry.sensitivityMax,
          source: 'acl',
        }));
  const scopes = authz.isOwner
    ? ['workspace.owner', 'memory.export', 'connections.manage']
    : authz.entries
        .filter((entry) => entry.subjectId === subjectId && entry.effect === 'allow')
        .map(formatAclScope);

  return {
    subjectId,
    externalKey: actor?.externalKey ?? null,
    displayName: actor?.displayName ?? subjectId,
    kind: actor?.kind ?? 'unknown',
    isOwner: authz.isOwner,
    purpose: details?.purpose ?? null,
    allowedTools: details?.allowedTools ?? null,
    scopes,
    capabilities:
      authz.isOwner
        ? (LOCAL_AGENT_DETAILS[owner]?.capabilities ?? scopes)
        : (details?.capabilities ?? scopes),
    rights,
  };
}

function buildLocalMemoryDetail(memory: MemoryRecord) {
  const metadata = memory.metadata ?? {};
  return {
    id: memory.id,
    title: memory.title,
    content: memory.content,
    status: memory.status,
    sensitivity: memory.sensitivity,
    memoryType: memory.memoryType,
    projectId: memory.projectId,
    workspaceId: memory.workspaceId,
    recordedAt: memory.recordedAt,
    observedAt: memory.observedAt,
    validFrom: memory.validFrom,
    validTo: memory.validTo,
    sourceEventId: memory.sourceEventId,
    createdBySubject: memory.createdBySubject,
    supersededBy: memory.supersededBy,
    importance: memory.importance,
    confidence: memory.confidence,
    schemaVersion: memory.schemaVersion,
    source: metadata.source,
    evidence: metadata.evidence,
    provenance: metadata.provenance,
    metadata,
  };
}

function auditProjectId(entry: {
  afterState?: Record<string, unknown> | null;
  beforeState?: Record<string, unknown> | null;
}) {
  const afterProjectId = entry.afterState?.projectId;
  if (typeof afterProjectId === 'string') return afterProjectId;
  const beforeProjectId = entry.beforeState?.projectId;
  return typeof beforeProjectId === 'string' ? beforeProjectId : null;
}

function isForbiddenError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /forbidden|42501|unauthorized/i.test(message);
}

function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not found|P0002/i.test(message);
}

function missingProjectResponse(c: { json: (body: { error: string }, status: 400) => Response }) {
  return c.json({ error: 'project_id is required for this write' }, 400);
}

async function maybeEmbedCapturedMemory(
  gateway: SupabaseMemoryGateway,
  input: {
    subjectId: string;
    title: string;
    text: string;
    captureResult: {
      process?: { memoryId?: string | null } | null;
      [key: string]: unknown;
    };
  },
) {
  const memoryId = input.captureResult.process?.memoryId;
  if (!memoryId) return null;
  try {
    const embedded = await embedMemoryText(input.title, input.text);
    if (embedded.vector.length === 0) return null;
    return gateway.setMemoryEmbedding({
      subjectId: input.subjectId,
      memoryId,
      embedding: embedded.vector,
      engine: embedded.engine,
    });
  } catch (err) {
    const strict =
      (process.env.MEMORY_OS_EMBED_STRICT ?? '').trim() === '1' ||
      (process.env.MEMORY_OS_EMBED_STRICT ?? '').trim().toLowerCase() === 'true';
    if (strict) throw err;
    // Capture must succeed even if embedding persistence fails (non-strict).
    return null;
  }
}

const defaultSdkConnectorRegistry = createConnectorRegistry([
  githubConnector,
  gmailConnector,
  googleDriveConnector,
  googleCalendarConnector,
]);

const connectorDisplayNames: Record<string, string> = {
  github: 'GitHub',
  gmail: 'Gmail (stub)',
  'google-drive': 'Google Drive',
  'google-calendar': 'Google Calendar',
};

function buildLocalConnectorCatalog(connectorRegistry: ConnectorRegistry) {
  return connectorRegistry.list().map((manifest) => ({
    id: manifest.id,
    version: manifest.version,
    displayName: connectorDisplayNames[manifest.id] ?? manifest.id,
    authType: manifest.auth,
    capabilities: manifest.capabilities,
    supports: manifest.supports,
    storageModes: manifest.storage_modes,
  }));
}

type ConnectionLike = {
  id: string;
  connectorId: string;
  displayName?: string;
  status?: string;
  scopes?: string[];
  lastSyncAt?: string | null;
  lastError?: string | null;
  vaultRef?: string | null;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
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

function resolveOwnerSubjectId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.MEMORY_OS_OWNER_SUBJECT_ID?.trim();
  return explicit && explicit.length > 0 ? explicit : owner;
}

function tagWebhookCollection(
  collection: ConnectorCollection,
  addedAt = new Date().toISOString(),
): ConnectorCollection {
  return {
    ...collection,
    metadata: {
      ...(collection.metadata ?? {}),
      added_via: 'webhook',
      added_at: addedAt,
    },
  };
}

async function refreshAndSeedDiscoveredConnectionProjects(
  gateway: SupabaseMemoryGateway,
  subjectId: string,
  workspaceId: string,
  item: ConnectionLike,
  collections: ConnectorCollection[],
): Promise<ConnectionLike> {
  const refreshed = await gateway.refreshConnectionCollections({
    subjectId,
    connectionId: item.id,
    items: collections,
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
    return gateway.getConnection(subjectId, refreshed.id);
  }

  await gateway.mergeConnectionProjectBindings({
    subjectId,
    connectionId: item.id,
    projectBindings,
  });
  return gateway.getConnection(subjectId, item.id);
}

async function upsertAndSeedConnectionCollection(
  gateway: SupabaseMemoryGateway,
  subjectId: string,
  workspaceId: string,
  item: ConnectionLike,
  collection: ConnectorCollection,
): Promise<ConnectionLike> {
  await gateway.upsertConnectionCollectionItem({
    subjectId,
    connectionId: item.id,
    item: collection,
  });
  const refreshed = await gateway.getConnection(subjectId, item.id);
  if (connectionCollectionExclusionSet(refreshed.metadata).has(collection.id)) {
    return refreshed;
  }

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
  await gateway.upsertConnectionCollectionItem({
    subjectId,
    connectionId: item.id,
    item: collection,
    projectBindings: { [collection.id]: project.projectId },
  });
  return gateway.getConnection(subjectId, item.id);
}

async function discoverAndSeedConnectionProjects(
  gateway: SupabaseMemoryGateway,
  subjectId: string,
  workspaceId: string,
  item: ConnectionLike,
  connector: RegisteredConnector<any>,
): Promise<ConnectionLike> {
  if (typeof connector.lifecycle.discover !== 'function') {
    return item;
  }

  const baseConnection =
    item.metadata === undefined ? await gateway.getConnection(subjectId, item.id) : item;

  const vault = createConfiguredVaultStore({ gateway });
  const discovered = await runConnectorDiscover({
    connector,
    context: {
      account: {
        connectionId: baseConnection.id,
        connectorId: baseConnection.connectorId,
        displayName: baseConnection.displayName ?? baseConnection.connectorId,
        vaultRef: baseConnection.vaultRef ?? undefined,
        scopes: baseConnection.scopes ?? [],
        metadata: baseConnection.metadata,
      },
      workspaceId,
      vault,
    },
  });

  if (!discovered) return item;
  return refreshAndSeedDiscoveredConnectionProjects(
    gateway,
    subjectId,
    workspaceId,
    baseConnection,
    discovered.collections,
  );
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

function describeDerivedHealth(connection: ConnectionLike) {
  switch (connection.status) {
    case 'revoked':
      return {
        status: 'revoked' as const,
        note: 'Connection access was revoked and will no longer enqueue sync jobs.',
        checks: [
          {
            name: 'connection_status',
            status: 'fail' as const,
            detail: 'Connector account status is revoked.',
          },
        ],
      };
    case 'disabled':
      return {
        status: 'disabled' as const,
        note: 'Connector is disabled for this workspace.',
        checks: [
          {
            name: 'connection_status',
            status: 'warn' as const,
            detail: 'Connector account status is disabled.',
          },
        ],
      };
    case 'reauth_required':
      return {
        status: 'reauth_required' as const,
        note: connection.lastError ?? 'OAuth reconnect is required before the next sync.',
        checks: [
          {
            name: 'connection_status',
            status: 'fail' as const,
            detail: connection.lastError ?? 'Connector account status is reauth_required.',
          },
        ],
      };
    case 'degraded':
      return {
        status: 'degraded' as const,
        note: connection.lastError ?? 'Connector is degraded because the last sync failed.',
        checks: [
          {
            name: 'connection_status',
            status: 'warn' as const,
            detail: connection.lastError ?? 'Connector account status is degraded.',
          },
        ],
      };
    default:
      return {
        status: 'healthy' as const,
        note: connection.vaultRef
          ? 'Connector account is connected and has a vault reference.'
          : 'Connector account is connected.',
        checks: [
          {
            name: 'connection_status',
            status: 'pass' as const,
            detail: 'Connector account status is connected.',
          },
        ],
      };
  }
}

async function buildConnectionHealth(
  gateway: SupabaseMemoryGateway | null,
  subjectId: string,
  connection: ConnectionLike,
  connectorRegistry: ConnectorRegistry,
) {
  const derived = describeDerivedHealth(connection);
  if (!gateway) {
    return {
      connectionId: connection.id,
      connectorId: connection.connectorId,
      status: derived.status,
      note: derived.note,
      vaultRef: connection.vaultRef ?? undefined,
      checkedAt: new Date().toISOString(),
      checks: derived.checks,
    };
  }
  if (connection.status === 'revoked' || connection.status === 'disabled') {
    return {
      connectionId: connection.id,
      connectorId: connection.connectorId,
      status: derived.status,
      note: derived.note,
      vaultRef: connection.vaultRef ?? undefined,
      checkedAt: new Date().toISOString(),
      checks: derived.checks,
    };
  }
  const connector = connectorRegistry.get(connection.connectorId);
  if (!connector) {
    return {
      connectionId: connection.id,
      connectorId: connection.connectorId,
      status: derived.status,
      note: derived.note,
      vaultRef: connection.vaultRef ?? undefined,
      checkedAt: new Date().toISOString(),
      checks: derived.checks,
    };
  }
  const vault = createConfiguredVaultStore({ gateway });
  return (
    (await runConnectorHealthcheck({
      connector,
      context: {
        account: {
          connectionId: connection.id,
          connectorId: connection.connectorId,
          displayName: connection.displayName,
          vaultRef: connection.vaultRef ?? undefined,
          scopes: connection.scopes ?? [],
        },
        workspaceId: connection.workspaceId ?? seedWorkspace,
        vault,
      },
    })) ?? {
      connectionId: connection.id,
      connectorId: connection.connectorId,
      status: derived.status,
      note: derived.note,
      vaultRef: connection.vaultRef ?? undefined,
      checkedAt: new Date().toISOString(),
      checks: derived.checks,
    }
  );
}

async function ingestSdkConnectorDelta(
  gateway: SupabaseMemoryGateway,
  subjectId: string,
  workspaceId: string,
  item: ConnectionLike,
  connector: RegisteredConnector<any>,
) {
  const syncedConnection = await discoverAndSeedConnectionProjects(
    gateway,
    subjectId,
    workspaceId,
    item,
    connector,
  );
  const stream = connector.manifest.default_stream ?? connector.manifest.id;
  const vault = createConfiguredVaultStore({ gateway });
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
    await maybeEmbedCapturedMemory(gateway, {
      subjectId,
      title: record.capture.title,
      text: record.capture.text,
      captureResult,
    });
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

function resolveCorsOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = env.MEMORY_OS_CORS_ORIGINS?.split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (configured && configured.length > 0) return configured;
  return ['http://localhost:5173', 'http://127.0.0.1:5173'];
}

export function createApp(options?: {
  store?: MemoryStore;
  gateway?: SupabaseMemoryGateway | null;
  connectorRegistry?: ConnectorRegistry;
}) {
  const store = options?.store ?? createSeededStore();
  const gateway = options?.gateway ?? null;
  const connectorRegistry = options?.connectorRegistry ?? defaultSdkConnectorRegistry;
  const mcp = createMcpHandlers({
    store,
    gateway,
    profile: process.env.MEMORY_OS_MCP_PROFILE,
    connectorRegistry,
  });
  const app = new Hono<{ Variables: ApiVariables }>();

  app.use(
    '*',
    cors({
      origin: resolveCorsOrigins(),
      allowHeaders: [
        'Content-Type',
        'x-subject-id',
        'x-actor-key',
        'x-client-id',
        'x-auth-user-id',
        'x-memory-os-api-secret',
        'x-request-id',
        'Authorization',
      ],
      exposeHeaders: ['x-request-id'],
    }),
  );

  app.use('*', withRequestId);

  app.use('*', async (c, next) => {
    const headerSubject = c.req.header('x-subject-id');
    const actorKey = c.req.header('x-actor-key');
    const clientId = c.req.header('x-client-id');
    const authUserId = c.req.header('x-auth-user-id');
    c.set('store', store);
    c.set('gateway', gateway);

    let subjectId = owner;
    let actorMeta: ApiVariables['actor'] = {
      id: owner,
      externalKey: 'owner',
      displayName: 'Sasha',
      kind: 'user',
    };

    if (gateway && (headerSubject || actorKey || clientId || authUserId)) {
      try {
        const resolved = await gateway.resolveSubject({
          workspaceId: seedWorkspace,
          subjectId: headerSubject,
          actorKey,
          clientId,
          authUserId,
        });
        subjectId = resolved.id;
        actorMeta = {
          id: resolved.id,
          externalKey: resolved.externalKey,
          displayName: resolved.displayName,
          kind: resolved.kind,
        };
      } catch {
        const local = resolveLocalSubject({
          subjectId: headerSubject,
          actorKey,
          clientId,
        });
        if (local) {
          subjectId = local.id;
          actorMeta = local;
        } else if (headerSubject) {
          subjectId = headerSubject;
          actorMeta = { id: headerSubject };
        }
      }
    } else {
      const local = resolveLocalSubject({
        subjectId: headerSubject,
        actorKey,
        clientId,
      });
      if (local) {
        subjectId = local.id;
        actorMeta = local;
      } else if (headerSubject) {
        subjectId = headerSubject;
        actorMeta = { id: headerSubject };
      }
    }

    c.set('actor', actorMeta);
    c.set('authz', seedAuthz(subjectId));
    await next();
  });

  app.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'memory-api',
      backend: gateway ? 'supabase' : 'memory-store',
      embedEngine: (process.env.MEMORY_OS_EMBED_ENGINE ?? 'stub').trim() || 'stub',
      vaultBackend:
        (process.env.MEMORY_OS_VAULT_BACKEND ?? '').trim() ||
        (process.env.MEMORY_OS_SUPABASE_URL ? 'supabase' : 'local'),
      connectorPullMode:
        (process.env.MEMORY_OS_CONNECTOR_PULL_MODE ?? 'auto').trim() || 'auto',
      mcp: '/mcp',
      mcpProfile: mcp.profile,
      requestId: c.get('requestId'),
    }),
  );

  // Remote MCP Streamable HTTP (ChatGPT mode A when host reachable).
  // Auth outside local/test. POST returns application/json JSON-RPC responses.
  app.use('/mcp', requireHttpApiSecret);
  app.get('/mcp/health', (c) =>
    c.json({
      ok: true,
      service: 'memory-os-mcp',
      backend: mcp.backend,
      profile: mcp.profile,
      transport: 'streamable-http',
    }),
  );
  // Stateless JSON-only: no long-lived GET SSE stream on /mcp.
  app.get('/mcp', (c) => {
    c.header('Allow', 'POST');
    return c.json({ error: 'method_not_allowed', allow: ['POST'] }, 405);
  });
  app.post('/mcp', async (c) => {
    let msg: JsonRpcReq;
    try {
      msg = (await c.req.json()) as JsonRpcReq;
    } catch {
      return c.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        },
        400,
      );
    }
    const result = await handleMcpJsonRpc(mcp, msg);
    if (result === null) return c.body(null, 204);
    return c.json(result);
  });

  // Owner/cron ops — require HTTP API secret outside local/test (see httpAuth.ts).
  app.use('/v1/consolidation/*', requireHttpApiSecret);
  app.use('/v1/connections/sync', requireHttpApiSecret);
  app.use('/v1/connections/*/resync', requireHttpApiSecret);
  app.use('/v1/jobs/dead-letter-stale', requireHttpApiSecret);
  app.use('/v1/jobs/*/replay', requireHttpApiSecret);
  app.use('/v1/outbox/*', requireHttpApiSecret);
  app.use('/v1/memories/embed-missing', requireHttpApiSecret);
  app.use('/v1/export/*', requireHttpApiSecret);

  app.post('/v1/webhooks/:connectorId', async (c) => {
    const connectorId = c.req.param('connectorId');
    const connector = connectorRegistry.get(connectorId);
    if (!connector) {
      return c.json({ error: 'connector_not_found' }, 404);
    }
    if (connectorId !== 'github') {
      return c.json(
        {
          error: 'not_implemented',
          note: 'Webhook receiver currently supports GitHub only. Full GitHub App install remains M10.',
        },
        501,
      );
    }

    const rawBody = await c.req.raw.text();
    const verification = verifyGitHubWebhookSignature({
      rawBody,
      signatureHeader: c.req.header(GITHUB_WEBHOOK_SIGNATURE_HEADER),
    });
    if (!verification.ok) {
      return c.json({ error: 'unauthorized', reason: verification.error }, 401);
    }

    let payload: GitHubWebhookPayload;
    try {
      payload = parseGitHubWebhookPayload(rawBody);
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const event = (c.req.header(GITHUB_WEBHOOK_EVENT_HEADER) ?? '').trim().toLowerCase();
    if (!event) {
      return c.json({ error: 'missing_event' }, 400);
    }

    const connectionId = c.req.query('connection_id') ?? payload.connection_id ?? null;
    if (!connectionId) {
      return c.json({ error: 'connection_id_required' }, 400);
    }

    const deliveryId = c.req.header(GITHUB_WEBHOOK_DELIVERY_HEADER)?.trim() ?? null;
    const action = describeGitHubWebhookAction({ event, payload });
    const gw = c.get('gateway');
    if (!gw) {
      return c.json(
        {
          accepted: true,
          duplicate: false,
          connectorId,
          connectionId,
          deliveryId,
          event,
          action,
          enqueued: 0,
          backend: 'memory-store',
          note: 'webhook receiver requires supabase backend for project upsert and sync enqueue',
        },
        event === 'ping' ? 200 : 202,
      );
    }

    const subjectId = resolveOwnerSubjectId();
    try {
      const connection = await gw.getConnection(subjectId, connectionId);
      if (connection.connectorId !== connectorId) {
        return c.json({ error: 'connection_connector_mismatch' }, 400);
      }

      const previousCursor = toSyncCursor(
        await gw.getConnectorCursor({
          subjectId,
          accountId: connection.id,
          stream: GITHUB_WEBHOOK_CURSOR_STREAM,
        }),
      );
      if (deliveryId && previousCursor?.opaque.deliveryId === deliveryId) {
        return c.json({
          accepted: true,
          duplicate: true,
          connectorId,
          connectionId: connection.id,
          deliveryId,
          event,
          action,
          enqueued: 0,
          note: 'duplicate delivery ignored',
        });
      }

      let updatedConnection: ConnectionLike = connection;
      let projectId: string | null = null;
      let enqueued = 0;
      let note = `github ${event} webhook acknowledged without connector action`;

      switch (event) {
        case 'ping':
          note = 'github webhook ping acknowledged';
          break;
        case 'push': {
          const pushCollection = resolveGitHubWebhookRepositoryCollection(payload);
          if (
            pushCollection &&
            connectionCollectionExclusionSet(connection.metadata).has(pushCollection.id)
          ) {
            note = 'github push acknowledged for excluded repository; sync enqueue skipped';
            break;
          }
          const sync = await gw.enqueueConnectorSync({
            subjectId,
            workspaceId: connection.workspaceId,
            connectionId: connection.id,
          });
          enqueued = sync.count ?? 0;
          note = 'connector sync enqueued from github push';
          break;
        }
        case 'public':
        case 'repository': {
          const shouldSeedRepository =
            event === 'public' ||
            payload.action === 'created' ||
            payload.action === 'publicized';
          if (!shouldSeedRepository) {
            note = payload.action
              ? `github repository.${payload.action} ignored`
              : 'github repository webhook ignored';
            break;
          }
          const collection = resolveGitHubWebhookRepositoryCollection(payload);
          if (!collection) {
            return c.json({ error: 'repository_payload_required' }, 400);
          }
          const taggedCollection = tagWebhookCollection(collection);
          updatedConnection = await upsertAndSeedConnectionCollection(
            gw,
            subjectId,
            connection.workspaceId,
            connection,
            taggedCollection,
          );
          projectId = resolveCollectionProjectId(updatedConnection.metadata, taggedCollection.id);
          if (projectId) {
            const sync = await gw.enqueueConnectorSync({
              subjectId,
              workspaceId: connection.workspaceId,
              connectionId: connection.id,
            });
            enqueued = sync.count ?? 0;
            note = 'repository project upserted and connector sync enqueued';
          } else {
            note = 'repository recorded but excluded from project seeding and sync enqueue';
          }
          break;
        }
        default:
          break;
      }

      await gw.upsertConnectorCursor({
        subjectId,
        accountId: connection.id,
        stream: GITHUB_WEBHOOK_CURSOR_STREAM,
        cursor: {
          deliveryId,
          event,
          action,
          receivedAt: new Date().toISOString(),
          repositoryId:
            payload.repository?.id != null ? String(payload.repository.id) : null,
          repositoryFullName: payload.repository?.full_name ?? null,
        },
        schemaVersion: '1.0',
      });
      await gw.appendAuditEvent({
        subjectId,
        workspaceId: connection.workspaceId,
        action: 'connection.webhook.received',
        objectType: 'connector_webhook',
        objectId: deliveryId,
        reason: `${connectorId}.${action}`,
        afterState: {
          connectionId: connection.id,
          connectorId,
          event,
          action,
          deliveryId,
          projectId,
          enqueued,
          repository: payload.repository?.full_name ?? null,
        },
      });

      return c.json(
        {
          accepted: true,
          duplicate: false,
          connectorId,
          connectionId: updatedConnection.id,
          deliveryId,
          event,
          action,
          projectId,
          enqueued,
          note,
        },
        event === 'ping' ? 200 : 202,
      );
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      console.error(
        JSON.stringify({
          event: 'connector_webhook_failed',
          connectorId,
          connectionId,
          deliveryId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return c.json({ error: 'internal_error' }, 500);
    }
  });

  app.get('/v1/me', (c) => {
    const authz = c.get('authz');
    const actor = c.get('actor');
    return c.json({
      subjectId: authz.subjectId,
      workspaceId: authz.workspaceId,
      isOwner: authz.isOwner,
      actor,
    });
  });

  app.get('/v1/agents/rights', async (c) => {
    const authz = c.get('authz');
    const actor = c.get('actor');
    const workspaceId = c.req.query('workspace_id') ?? seedWorkspace;
    const gw = c.get('gateway');
    if (gw) {
      try {
        const matrix = await gw.getAgentRights({
          subjectId: authz.subjectId,
          workspaceId,
        });
        return c.json(matrix);
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }
    return c.json({
      currentActor: {
        subjectId: authz.subjectId,
        isOwner: authz.isOwner,
        actor,
      },
      actors: [owner, chatgpt, cursor, roma].map(buildLocalAgentRow),
      backend: 'memory-store',
    });
  });

  app.get('/v1/audit', async (c) => {
    const authz = c.get('authz');
    const workspaceId = c.req.query('workspace_id') ?? seedWorkspace;
    const projectId = c.req.query('project_id') ?? null;
    const limit = Number(c.req.query('limit') ?? '50');
    const gw = c.get('gateway');
    if (gw) {
      try {
        const result = await gw.listAudit({
          subjectId: authz.subjectId,
          workspaceId,
          limit: Number.isFinite(limit) ? limit : 50,
        });
        const events =
          projectId === null
            ? result.events
            : result.events.filter((event) => {
                const afterProjectId =
                  typeof event.afterState?.projectId === 'string'
                    ? event.afterState.projectId
                    : null;
                const beforeProjectId =
                  typeof event.beforeState?.projectId === 'string'
                    ? event.beforeState.projectId
                    : null;
                return afterProjectId === projectId || beforeProjectId === projectId;
              });
        return c.json({ ...result, events });
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }
    const events = c
      .get('store')
      .listAudit(workspaceId, Number.isFinite(limit) ? limit : 50)
      .filter((entry) => projectId === null || auditProjectId(entry) === projectId)
      .map((entry) => ({
        ...entry,
        actor: resolveSeedActor(entry.actorSubjectId),
      }));
    return c.json({ events, backend: 'memory-store' });
  });

  app.get('/v1/connectors', async (c) => {
    const authz = c.get('authz');
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({
        connectors: buildLocalConnectorCatalog(connectorRegistry),
        backend: 'memory-store',
      });
    }
    try {
      const connectors = await gw.listConnectors(authz.subjectId);
      return c.json({ connectors });
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/v1/connections', async (c) => {
    const authz = c.get('authz');
    const workspaceId = c.req.query('workspace_id') ?? seedWorkspace;
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({
        connections: [
          {
            id: '88888888-8888-4888-8888-888888888801',
            connectorId: 'github',
            displayName: 'AISTROYKA repos',
            status: 'connected',
            scopes: ['repositories.read'],
            metadata: {
              collections: {
                selection_mode: 'all',
                excluded_ids: [],
                items: [
                  {
                    id: 'aistroyka/core',
                    kind: 'repository',
                    name: 'core',
                    title: 'aistroyka/core',
                    url: 'https://github.com/aistroyka/core',
                    description: 'Основной продуктовый репозиторий AISTROYKA.',
                    default_branch: 'main',
                  },
                  {
                    id: 'sasha-memory-os/platform',
                    kind: 'repository',
                    name: 'platform',
                    title: 'sasha-memory-os/platform',
                    url: 'https://github.com/sasha-memory-os/platform',
                    description: 'Пилотная монорепа Sasha Memory OS.',
                    default_branch: 'main',
                  },
                ],
              },
            },
          },
        ],
      });
    }
    try {
      const connections = await gw.listConnections(authz.subjectId, workspaceId);
      return c.json({ connections });
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/v1/connections/:id/health', async (c) => {
    const connectionId = c.req.param('id');
    const authz = c.get('authz');
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({
        connectionId,
        connectorId: 'github',
        status: 'healthy',
        note: 'Local preview uses synthetic connector health.',
        checkedAt: new Date().toISOString(),
        checks: [
          {
            name: 'preview_mode',
            status: 'pass',
            detail: 'Local preview connection health is synthetic.',
          },
        ],
        backend: 'memory-store',
      });
    }
    try {
      const connection = await gw.getConnection(authz.subjectId, connectionId);
      const health = await buildConnectionHealth(
        gw,
        authz.subjectId,
        connection,
        connectorRegistry,
      );
      return c.json(health);
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/connections/:id/discover', async (c) => {
    const connectionId = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as {
      workspace_id?: string;
      actor_subject_id?: string;
    };
    const authz = c.get('authz');
    const actorSubjectId = body.actor_subject_id ?? authz.subjectId;
    if (!authz.isOwner && authz.subjectId !== actorSubjectId) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({
        connectionId,
        collections: selectedConnectionCollections({
          collections: {
            selection_mode: 'all',
            excluded_ids: [],
            items: [
              {
                id: 'aistroyka/core',
                kind: 'repository',
                name: 'core',
                title: 'aistroyka/core',
                url: 'https://github.com/aistroyka/core',
                description: 'Основной продуктовый репозиторий AISTROYKA.',
                default_branch: 'main',
                metadata: {},
              },
              {
                id: 'sasha-memory-os/platform',
                kind: 'repository',
                name: 'platform',
                title: 'sasha-memory-os/platform',
                url: 'https://github.com/sasha-memory-os/platform',
                description: 'Пилотная монорепа Sasha Memory OS.',
                default_branch: 'main',
                metadata: {},
              },
            ],
          },
        }),
        backend: 'memory-store',
      });
    }
    try {
      const connection = await gw.getConnection(actorSubjectId, connectionId);
      const connector = connectorRegistry.get(connection.connectorId);
      if (!connector || typeof connector.lifecycle.discover !== 'function') {
        return c.json({
          connectionId,
          collections: [],
          note: 'connector does not support discover',
        });
      }
      const updated = await discoverAndSeedConnectionProjects(
        gw,
        actorSubjectId,
        connection.workspaceId,
        connection,
        connector,
      );
      return c.json({
        connectionId,
        collections: selectedConnectionCollections(updated.metadata),
        metadata: updated.metadata ?? {},
      });
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/connections/sync', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      workspace_id?: string;
      connection_id?: string;
      actor_subject_id?: string;
      complete_now?: boolean;
    };
    const authz = c.get('authz');
    const workspaceId = body.workspace_id ?? seedWorkspace;
    const actorSubjectId = body.actor_subject_id ?? authz.subjectId;
    if (!authz.isOwner && authz.subjectId !== actorSubjectId) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const gw = c.get('gateway');
    if (!gw) {
      c.get('store').createAuditEvent({
        workspaceId,
        actorSubjectId: actorSubjectId,
        action: 'connection.sync.requested',
        objectType: 'connector_sync',
        reason: 'connector sync requested in memory-store mode',
        afterState: {
          connectionId: body.connection_id ?? null,
          count: 0,
        },
      });
      return c.json({
        count: 0,
        enqueued: [],
        completed: [],
        backend: 'memory-store',
        note: 'connector sync requires supabase backend',
      });
    }
    try {
      const result = await gw.enqueueConnectorSync({
        subjectId: actorSubjectId,
        workspaceId,
        connectionId: body.connection_id ?? null,
      });
      const completed: Array<Record<string, unknown>> = [];
      let captured = 0;
      if (body.complete_now !== false) {
        for (const item of result.enqueued ?? []) {
          if (!item.jobId) continue;
          try {
            const sdkConnector = connectorRegistry.get(item.connectorId);
            let pullMode = 'none';
            let note = 'unsupported connector';
            if (sdkConnector) {
              const ingested = await ingestSdkConnectorDelta(
                gw,
                actorSubjectId,
                workspaceId,
                {
                  id: item.connectionId,
                  connectorId: item.connectorId,
                  displayName: item.displayName,
                  vaultRef: item.vaultRef,
                },
                sdkConnector,
              );
              captured += ingested.captured;
              pullMode = ingested.pullMode;
              note = ingested.note;
            }
            const outcome = resolveConnectorSyncOutcome({ pullMode, note });
            completed.push({
              ...(await gw.completeConnectorSync({
                subjectId: actorSubjectId,
                jobId: item.jobId,
                status: outcome.status,
                error: outcome.error,
              })),
              pullMode,
              note,
            });
          } catch (err) {
            completed.push(
              await gw.completeConnectorSync({
                subjectId: actorSubjectId,
                jobId: item.jobId,
                status: 'failed',
                error: (err as Error).message,
              }),
            );
          }
        }
      }
      await gw.appendAuditEvent({
        subjectId: actorSubjectId,
        workspaceId,
        action: 'connection.sync.requested',
        objectType: 'connector_sync',
        reason: body.connection_id
          ? `connector sync requested for ${body.connection_id}`
          : 'connector sync requested',
        afterState: {
          connectionId: body.connection_id ?? null,
          enqueued: result.count ?? 0,
          completed: completed.length,
          captured,
        },
      });
      return c.json({ ...result, completed, captured }, 202);
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/connections/:id/revoke', async (c) => {
    const connectionId = c.req.param('id');
    const body = revokeConnectionSchema.parse(await c.req.json().catch(() => ({})));
    const authz = c.get('authz');
    if (!authz.isOwner && authz.subjectId !== body.actor_subject_id) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({
        id: connectionId,
        connectorId: 'github',
        status: 'revoked',
        revoked: true,
        backend: 'memory-store',
      });
    }
    try {
      const connection = await gw.getConnection(body.actor_subject_id, connectionId);
      const connector = connectorRegistry.get(connection.connectorId);
      const vault = createConfiguredVaultStore({ gateway: gw });
      if (connector) {
        await connector.lifecycle.revoke?.({
          account: {
            connectionId: connection.id,
            connectorId: connection.connectorId,
            displayName: connection.displayName,
            vaultRef: connection.vaultRef ?? undefined,
            scopes: connection.scopes ?? [],
          },
          workspaceId: connection.workspaceId,
          vault,
        });
      } else if (connection.vaultRef) {
        await vault.delete(connection.vaultRef);
      }
      const updated = await gw.setConnectionStatus({
        subjectId: body.actor_subject_id,
        connectionId,
        status: 'revoked',
        lastError: null,
      });
      return c.json({ ...updated, revoked: true });
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/connections/:id/resync', async (c) => {
    const connectionId = c.req.param('id');
    const body = resyncConnectionSchema.parse(await c.req.json().catch(() => ({})));
    const authz = c.get('authz');
    if (!authz.isOwner && authz.subjectId !== body.actor_subject_id) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const gw = c.get('gateway');
    if (!gw) {
      return c.json(
        {
          connectionId,
          clearedCursorCount: 0,
          backend: 'memory-store',
          note: 'connector resync requires supabase backend',
        },
        501,
      );
    }
    try {
      const connection = await gw.getConnection(body.actor_subject_id, connectionId);
      const result = await gw.resyncConnector({
        subjectId: body.actor_subject_id,
        workspaceId: connection.workspaceId,
        connectionId,
      });
      return c.json({ ...result, resync: true }, 202);
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/connections', async (c) => {
    const body = upsertConnectionSchema.parse(await c.req.json());
    const authz = c.get('authz');
    if (!authz.isOwner && authz.subjectId !== body.actor_subject_id) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const gw = c.get('gateway');
    if (!gw) {
      return c.json(
        {
          id: crypto.randomUUID(),
          connectorId: body.connector_id,
          displayName: body.display_name,
          status: body.status,
          scopes: body.scopes,
          backend: 'memory-store',
        },
        201,
      );
    }
    try {
      const connection = await gw.upsertConnection({
        subjectId: body.actor_subject_id,
        workspaceId: body.workspace_id,
        connectorId: body.connector_id,
        displayName: body.display_name,
        scopes: body.scopes,
        status: body.status,
        metadata: body.metadata,
      });
      return c.json(connection, 201);
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/oauth/start', async (c) => {
    const body = oauthStartSchema.parse(await c.req.json());
    const authz = c.get('authz');
    if (!authz.isOwner && authz.subjectId !== body.actor_subject_id) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const gw = c.get('gateway');
    const authorizeBase = resolveAuthorizeBase(body.connector_id);
    if (!gw) {
      const state = crypto.randomUUID().replace(/-/g, '');
      return c.json(
        {
          state,
          connectionId: crypto.randomUUID(),
          authorizeUrl: `stub://oauth/${body.connector_id}?state=${state}`,
          backend: 'memory-store',
        },
        201,
      );
    }
    try {
      const result = await gw.oauthStart({
        subjectId: body.actor_subject_id,
        workspaceId: body.workspace_id,
        connectorId: body.connector_id,
        displayName: body.display_name,
        scopes: body.scopes,
        redirectUri: body.redirect_uri,
        authorizeBase,
      });
      return c.json(result, 201);
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/oauth/callback', async (c) => {
    const body = oauthCompleteSchema.parse(await c.req.json());
    const authz = c.get('authz');
    if (!authz.isOwner && authz.subjectId !== body.actor_subject_id) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const codeFingerprint = fingerprintAuthorizationCode(body.code);
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({
        status: 'connected',
        tokenPersisted: false,
        vaultRef: `vault:local/connectors/stub/${body.state}`,
        exchangeMode: 'stub',
        codeFingerprint,
        backend: 'memory-store',
      });
    }
    try {
      // Peek → HTTP exchange into vault → complete with mode. Raw code never sent to DB.
      const peeked = await gw.oauthPeekState({
        subjectId: body.actor_subject_id,
        state: body.state,
      });
      const vault = createConfiguredVaultStore({ gateway: gw });
      const exchange = await exchangeAuthorizationCode({
        connectorId: peeked.connectorId,
        connectionId: peeked.connectionId,
        code: body.code,
        redirectUri: peeked.redirectUri,
        vault,
      });
      const result = await gw.oauthCompleteStub({
        subjectId: body.actor_subject_id,
        state: body.state,
        codeFingerprint: exchange.codeFingerprint ?? codeFingerprint,
        exchangeMode: exchange.exchangeMode,
      });
      const connection = await gw.getConnection(body.actor_subject_id, result.connectionId);
      const connector = connectorRegistry.get(connection.connectorId);
      const discovered =
        connector && typeof connector.lifecycle.discover === 'function'
          ? await discoverAndSeedConnectionProjects(
              gw,
              body.actor_subject_id,
              connection.workspaceId,
              connection,
              connector,
            )
          : connection;
      return c.json({
        ...result,
        vaultRef: exchange.vaultRef,
        tokenPersisted: false,
        exchangeMode: exchange.exchangeMode,
        codeFingerprint: exchange.codeFingerprint,
        clientIdConfigured: exchange.clientIdConfigured,
        clientSecretConfigured: exchange.clientSecretConfigured,
        tokensInVault: exchange.exchangeMode === 'exchanged',
        note: exchange.note,
        discoveredCollections: selectedConnectionCollections(discovered.metadata).length,
      });
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/auth/bind', async (c) => {
    const body = bindAuthUserSchema.parse(await c.req.json());
    const authz = c.get('authz');
    const gw = c.get('gateway');
    if (!gw) {
      return c.json(
        {
          authUserId: body.auth_user_id,
          subjectId: crypto.randomUUID(),
          workspaceId: body.workspace_id,
          backend: 'memory-store',
        },
        201,
      );
    }
    try {
      const result = await gw.bindAuthUser({
        workspaceId: body.workspace_id,
        authUserId: body.auth_user_id,
        email: body.email,
        displayName: body.display_name,
        actingSubjectId: body.acting_subject_id ?? authz.subjectId,
      });
      return c.json(result, 201);
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/connections/:id/status', async (c) => {
    const connectionId = c.req.param('id');
    const body = setConnectionStatusSchema.parse(await c.req.json());
    const authz = c.get('authz');
    if (!authz.isOwner && authz.subjectId !== body.actor_subject_id) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({
        id: connectionId,
        status: body.status,
        lastError: body.last_error ?? null,
        backend: 'memory-store',
      });
    }
    try {
      const connection = await gw.setConnectionStatus({
        subjectId: body.actor_subject_id,
        connectionId,
        status: body.status,
        lastError: body.last_error,
      });
      return c.json(connection);
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.patch('/v1/connections/:id', async (c) => {
    const connectionId = c.req.param('id');
    const body = updateConnectionSchema.parse(await c.req.json());
    const authz = c.get('authz');
    if (!authz.isOwner && authz.subjectId !== body.actor_subject_id) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({
        id: connectionId,
        metadata: body.metadata,
        backend: 'memory-store',
      });
    }
    try {
      const collections =
        typeof body.metadata.collections === 'object' &&
        body.metadata.collections !== null &&
        !Array.isArray(body.metadata.collections)
          ? (body.metadata.collections as { excluded_ids?: unknown })
          : null;
      const excludedIdsRaw = collections?.excluded_ids;
      const excludedIds = Array.isArray(excludedIdsRaw)
        ? excludedIdsRaw.filter((value): value is string => typeof value === 'string')
        : null;
      const connection = excludedIds
        ? await gw.setConnectionCollectionExclusions({
            subjectId: body.actor_subject_id,
            connectionId,
            excludedIds,
          })
        : await gw.setConnectionMetadata({
            subjectId: body.actor_subject_id,
            connectionId,
            metadata: body.metadata,
          });
      return c.json(connection);
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/v1/rls/probe', async (c) => {
    const projectId = c.req.query('project_id') ?? null;
    const sensitivity = c.req.query('sensitivity') ?? 'internal';
    const authz = c.get('authz');
    const gw = c.get('gateway');
    if (!projectId) {
      return c.json({ error: 'project_id is required for rls probe' }, 400);
    }
    if (!gw) {
      return c.json({
        subjectId: authz.subjectId,
        backend: 'memory-store',
        canReadMemory: authorize(authz, {
          resourceType: 'memory',
          action: 'read',
          projectId,
          sensitivity: sensitivity as 'internal',
        }),
        canWriteMemory: authorize(authz, {
          resourceType: 'memory',
          action: 'write',
          projectId,
          sensitivity: sensitivity as 'internal',
        }),
        canWriteHandoff: authorize(authz, {
          resourceType: 'handoff',
          action: 'write',
          projectId,
        }),
      });
    }
    try {
      const probe = await gw.rlsProbe({
        subjectId: authz.subjectId,
        projectId,
        sensitivity,
      });
      return c.json(probe);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/ingestion/events', async (c) => {
    const body = ingestionEnvelopeSchema.parse(await c.req.json());
    const authz = c.get('authz');
    if (
      !authorize(authz, {
        resourceType: 'source_event',
        action: 'write',
        projectId: body.scope.project_id,
        sensitivity: body.scope.sensitivity,
      }) &&
      !authz.isOwner &&
      !authorize(authz, {
        resourceType: 'memory',
        action: 'write',
        projectId: body.scope.project_id,
        sensitivity: body.scope.sensitivity,
      })
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const event = c.get('store').ingestEvent({
      workspaceId: body.workspace_id,
      projectId: body.scope.project_id ?? null,
      provider: body.source.provider,
      eventType: body.event_type,
      idempotencyKey: body.idempotency_key,
      observedAt: body.observed_at,
      sensitivity: body.scope.sensitivity,
      payload: body as unknown as Record<string, unknown>,
      createdBySubject: authz.subjectId,
    });
    return c.json({ id: event.id, idempotent: true }, 201);
  });

  app.post('/v1/capture/text', async (c) => {
    const body = captureTextSchema.parse(await c.req.json());
    if (!body.project_id) return missingProjectResponse(c);
    const authz = c.get('authz');
    if (
      !authorize(authz, {
        resourceType: 'memory',
        action: 'write',
        projectId: body.project_id,
        sensitivity: body.sensitivity,
      })
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }

    const gw = c.get('gateway');
    if (gw) {
      try {
        const result = await gw.captureText({
          subjectId: body.actor_subject_id,
          workspaceId: body.workspace_id,
          projectId: body.project_id,
          title: body.title,
          text: body.text,
          idempotencyKey: body.idempotency_key,
          sensitivity: body.sensitivity,
          processNow: body.process_now,
        });
        const embedding = await maybeEmbedCapturedMemory(gw, {
          subjectId: body.actor_subject_id,
          title: body.title,
          text: body.text,
          captureResult: result,
        });
        return c.json({ ...result, embedding }, 201);
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }

    const result = c.get('store').captureText({
      workspaceId: body.workspace_id,
      projectId: body.project_id,
      title: body.title,
      text: body.text,
      actorSubjectId: body.actor_subject_id,
      idempotencyKey: body.idempotency_key,
      sensitivity: body.sensitivity,
    });
    return c.json(result, 201);
  });

  app.post('/v1/capture/document', async (c) => {
    const body = captureDocumentSchema.parse(await c.req.json());
    if (!body.project_id) return missingProjectResponse(c);
    const authz = c.get('authz');
    if (
      !authorize(authz, {
        resourceType: 'memory',
        action: 'write',
        projectId: body.project_id,
        sensitivity: body.sensitivity,
      })
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }

    let parsed;
    try {
      parsed = await extractTextFromBytes({
        filename: body.filename,
        mimeType: body.mime_type,
        bytes: decodeBase64Document(body.content_base64),
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const enrichedText = [
      `Source file: ${parsed.filename} (${parsed.mimeType})`,
      parsed.engine !== 'native' ? `OCR engine: ${parsed.engine}` : null,
      parsed.pageHint ? `Pages: ${parsed.pageHint}` : null,
      '',
      parsed.text,
    ]
      .filter((line) => line !== null)
      .join('\n');

    const gw = c.get('gateway');
    if (gw) {
      try {
        const result = await gw.captureText({
          subjectId: body.actor_subject_id,
          workspaceId: body.workspace_id,
          projectId: body.project_id,
          title: body.title,
          text: enrichedText,
          idempotencyKey: body.idempotency_key,
          sensitivity: body.sensitivity,
          processNow: body.process_now,
          filename: parsed.filename,
          mimeType: parsed.mimeType,
        });
        const embedding = await maybeEmbedCapturedMemory(gw, {
          subjectId: body.actor_subject_id,
          title: body.title,
          text: enrichedText,
          captureResult: result,
        });
        return c.json(
          {
            ...(result as Record<string, unknown>),
            extractedChars: parsed.text.length,
            pageHint: parsed.pageHint ?? null,
            embedding,
          },
          201,
        );
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }

    const result = c.get('store').captureText({
      workspaceId: body.workspace_id,
      projectId: body.project_id,
      title: body.title,
      text: enrichedText,
      actorSubjectId: body.actor_subject_id,
      idempotencyKey: body.idempotency_key,
      sensitivity: body.sensitivity,
    });
    return c.json(
      {
        ...result,
        filename: parsed.filename,
        mimeType: parsed.mimeType,
        extractedChars: parsed.text.length,
        pageHint: parsed.pageHint ?? null,
      },
      201,
    );
  });

  app.post('/v1/capture/link', async (c) => {
    const body = captureLinkSchema.parse(await c.req.json());
    if (!body.project_id) return missingProjectResponse(c);
    const authz = c.get('authz');
    if (
      !authorize(authz, {
        resourceType: 'memory',
        action: 'write',
        projectId: body.project_id,
        sensitivity: body.sensitivity,
      })
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }

    let fetched;
    try {
      fetched = await fetchPublicLink(body.url);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const title = body.title ?? fetched.title;
    const text = [
      `Source URL: ${fetched.finalUrl}`,
      fetched.contentType ? `Content-Type: ${fetched.contentType}` : null,
      '',
      fetched.text,
    ]
      .filter((line) => line !== null)
      .join('\n');

    const gw = c.get('gateway');
    if (gw) {
      try {
        const result = await gw.captureText({
          subjectId: body.actor_subject_id,
          workspaceId: body.workspace_id,
          projectId: body.project_id,
          title,
          text,
          idempotencyKey: body.idempotency_key,
          sensitivity: body.sensitivity,
          processNow: body.process_now,
          filename: fetched.finalUrl,
          mimeType: 'text/html',
        });
        const embedding = await maybeEmbedCapturedMemory(gw, {
          subjectId: body.actor_subject_id,
          title,
          text,
          captureResult: result,
        });
        return c.json(
          {
            ...(result as Record<string, unknown>),
            url: fetched.url,
            finalUrl: fetched.finalUrl,
            extractedChars: fetched.text.length,
            embedding,
          },
          201,
        );
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }

    const result = c.get('store').captureText({
      workspaceId: body.workspace_id,
      projectId: body.project_id,
      title,
      text,
      actorSubjectId: body.actor_subject_id,
      idempotencyKey: body.idempotency_key,
      sensitivity: body.sensitivity,
    });
    return c.json(
      {
        ...result,
        url: fetched.url,
        finalUrl: fetched.finalUrl,
        extractedChars: fetched.text.length,
      },
      201,
    );
  });

  app.get('/v1/jobs/:id', async (c) => {
    const jobId = c.req.param('id');
    const authz = c.get('authz');
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({ id: jobId, status: 'succeeded', backend: 'memory-store' });
    }
    try {
      const job = await gw.getJob(authz.subjectId, jobId);
      if (!job) return c.json({ error: 'not found' }, 404);
      return c.json(job);
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/jobs/:id/process', async (c) => {
    const jobId = c.req.param('id');
    const authz = c.get('authz');
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({ error: 'supabase gateway required' }, 501);
    }
    try {
      const result = await gw.processIngestJob(authz.subjectId, jobId);
      return c.json(result);
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/jobs/:id/replay', async (c) => {
    const jobId = c.req.param('id');
    const body = replayConnectorJobSchema.parse(await c.req.json().catch(() => ({})));
    const authz = c.get('authz');
    if (!authz.isOwner && authz.subjectId !== body.actor_subject_id) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({ error: 'supabase gateway required' }, 501);
    }
    try {
      const result = await gw.replayConnectorSync({
        subjectId: body.actor_subject_id,
        jobId,
        resync: body.resync,
      });
      return c.json({ ...result, replayed: true }, 202);
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/v1/outbox/pending', async (c) => {
    const authz = c.get('authz');
    if (!authz.isOwner) return c.json({ error: 'forbidden' }, 403);
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({ count: 0, events: [], backend: 'memory-store' });
    }
    const workspaceId =
      c.req.query('workspace_id')?.trim() || seedWorkspace;
    const eventType = c.req.query('event_type')?.trim() || null;
    const limitRaw = Number(c.req.query('limit') ?? '50');
    try {
      const result = await gw.listOutboxPending({
        subjectId: authz.subjectId,
        workspaceId,
        eventType,
        limit: Number.isFinite(limitRaw) ? limitRaw : 50,
      });
      return c.json({ ...result, backend: 'supabase' });
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/jobs/dead-letter-stale', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      workspace_id?: string;
      older_than_minutes?: number;
    };
    const authz = c.get('authz');
    if (!authz.isOwner) return c.json({ error: 'forbidden' }, 403);
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({
        deadLettered: 0,
        backend: 'memory-store',
        note: 'dead-letter requires supabase backend',
      });
    }
    try {
      const result = await gw.deadLetterStaleJobs({
        subjectId: authz.subjectId,
        workspaceId: body.workspace_id ?? seedWorkspace,
        olderThanMinutes: body.older_than_minutes,
      });
      return c.json({ ...result, backend: 'supabase' });
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/outbox/:id/publish', async (c) => {
    const eventId = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { error?: string };
    const authz = c.get('authz');
    if (!authz.isOwner) return c.json({ error: 'forbidden' }, 403);
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({
        id: eventId,
        publishedAt: new Date().toISOString(),
        backend: 'memory-store',
      });
    }
    try {
      const result = await gw.publishOutboxEvent({
        subjectId: authz.subjectId,
        eventId,
        error: body.error ?? null,
      });
      return c.json({ ...result, backend: 'supabase' });
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/v1/memories', async (c) => {
    const authz = c.get('authz');
    const workspaceId = c.req.query('workspace_id') ?? seedWorkspace;
    const projectId = c.req.query('project_id') ?? undefined;
    const status = c.req.query('status') ?? undefined;
    const recordedAfter = c.req.query('recorded_after') ?? undefined;
    const recordedBefore = c.req.query('recorded_before') ?? undefined;
    const limit = Number(c.req.query('limit') ?? '50');
    const gw = c.get('gateway');
    if (gw) {
      try {
        const memories = await gw.listMemories({
          subjectId: authz.subjectId,
          workspaceId,
          projectId: projectId ?? null,
          status: status ?? null,
          limit: Number.isFinite(limit) ? limit : 50,
          recordedAfter: recordedAfter ?? null,
          recordedBefore: recordedBefore ?? null,
        });
        return c.json({ memories });
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }
    const memories = [...c.get('store').memories.values()]
      .filter((m) => {
        if (projectId && m.projectId !== projectId) return false;
        if (status && m.status !== status) return false;
        if (recordedAfter && m.recordedAt < recordedAfter) return false;
        if (recordedBefore && m.recordedAt > recordedBefore) return false;
        return authorize(authz, {
          resourceType: 'memory',
          action: 'read',
          projectId: m.projectId,
          sensitivity: m.sensitivity,
        });
      })
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .slice(0, Number.isFinite(limit) ? limit : 50)
      .map((m) => ({
        id: m.id,
        title: m.title,
        content: m.content.slice(0, 500),
        status: m.status,
        sensitivity: m.sensitivity,
        memoryType: m.memoryType,
        projectId: m.projectId,
        recordedAt: m.recordedAt,
        metadata: m.metadata,
      }));
    return c.json({ memories });
  });

  /** Owner portable dump (full content). Complements list truncation. */
  app.get('/v1/export/memories', async (c) => {
    const authz = c.get('authz');
    if (!authz.isOwner) return c.json({ error: 'forbidden' }, 403);
    const workspaceId = c.req.query('workspace_id') ?? seedWorkspace;
    const projectId = c.req.query('project_id') ?? undefined;
    const status = c.req.query('status') ?? undefined;
    const recordedAfter = c.req.query('recorded_after') ?? undefined;
    const recordedBefore = c.req.query('recorded_before') ?? undefined;
    const rawLimit = Number(c.req.query('limit') ?? '200');
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 200, 1), 500);
    const gw = c.get('gateway');
    const exportedAt = new Date().toISOString();

    if (gw) {
      try {
        const listed = (await gw.listMemories({
          subjectId: authz.subjectId,
          workspaceId,
          projectId: projectId ?? null,
          status: status ?? null,
          limit,
          recordedAfter: recordedAfter ?? null,
          recordedBefore: recordedBefore ?? null,
        })) as Array<{ id: string }>;
        const memories = [];
        for (const row of listed) {
          const memory = await gw.getMemory({
            subjectId: authz.subjectId,
            memoryId: row.id,
          });
          memories.push(memory);
        }
        await gw.appendAuditEvent({
          subjectId: authz.subjectId,
          workspaceId,
          action: 'memory.export',
          objectType: 'memory_export',
          reason: `exported ${memories.length} memories`,
          afterState: {
            workspaceId,
            count: memories.length,
            projectId: projectId ?? null,
            recordedAfter: recordedAfter ?? null,
            recordedBefore: recordedBefore ?? null,
          },
        });
        return c.json({
          format: 'memory-os.export.memories.v1',
          exportedAt,
          workspaceId,
          subjectId: authz.subjectId,
          count: memories.length,
          memories,
          recordedAfter: recordedAfter ?? null,
          recordedBefore: recordedBefore ?? null,
          backend: 'supabase',
        });
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }

    const memories = [...c.get('store').memories.values()]
      .filter((m) => {
        if (projectId && m.projectId !== projectId) return false;
        if (status && m.status !== status) return false;
        if (recordedAfter && m.recordedAt < recordedAfter) return false;
        if (recordedBefore && m.recordedAt > recordedBefore) return false;
        return authorize(authz, {
          resourceType: 'memory',
          action: 'read',
          projectId: m.projectId,
          sensitivity: m.sensitivity,
        });
      })
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .slice(0, limit)
      .map((m) => ({
        id: m.id,
        title: m.title,
        content: m.content,
        status: m.status,
        sensitivity: m.sensitivity,
        memoryType: m.memoryType,
        projectId: m.projectId,
        recordedAt: m.recordedAt,
        metadata: m.metadata,
      }));

    c.get('store').createAuditEvent({
      workspaceId,
      actorSubjectId: authz.subjectId,
      action: 'memory.export',
      objectType: 'memory_export',
      reason: `exported ${memories.length} memories`,
      afterState: {
        workspaceId,
        count: memories.length,
        projectId: projectId ?? null,
        recordedAfter: recordedAfter ?? null,
        recordedBefore: recordedBefore ?? null,
      },
    });

    return c.json({
      format: 'memory-os.export.memories.v1',
      exportedAt,
      workspaceId,
      subjectId: authz.subjectId,
      count: memories.length,
      memories,
      recordedAfter: recordedAfter ?? null,
      recordedBefore: recordedBefore ?? null,
      backend: 'memory-store',
    });
  });

  app.get('/v1/privacy/requests', async (c) => {
    const authz = c.get('authz');
    if (!authz.isOwner) return c.json({ error: 'forbidden' }, 403);
    const workspaceId = c.req.query('workspace_id') ?? seedWorkspace;
    const limit = Number(c.req.query('limit') ?? '50');
    const gw = c.get('gateway');
    if (gw) {
      try {
        const requests = await gw.listPrivacyRequests({
          subjectId: authz.subjectId,
          workspaceId,
          limit: Number.isFinite(limit) ? limit : 50,
        });
        return c.json(requests);
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }
    const requests = c
      .get('store')
      .listPrivacyRequests(workspaceId, Number.isFinite(limit) ? limit : 50)
      .map((request) => ({
        ...request,
        actor: resolveSeedActor(request.actorSubjectId),
      }));
    return c.json({ requests, backend: 'memory-store' });
  });

  app.post('/v1/privacy/requests', async (c) => {
    const body = createPrivacyRequestSchema.parse(await c.req.json());
    const authz = c.get('authz');
    if (!authz.isOwner || authz.subjectId !== body.actor_subject_id) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const gw = c.get('gateway');
    if (gw) {
      try {
        const request = await gw.createPrivacyRequest({
          subjectId: body.actor_subject_id,
          workspaceId: body.workspace_id,
          projectId: body.project_id ?? null,
          requestType: body.request_type,
          targetMemoryId: body.target_memory_id ?? null,
          reason: body.reason,
          correctionText: body.correction_text ?? null,
          idempotencyKey: body.idempotency_key,
        });
        return c.json(request, 201);
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }
    const request = c.get('store').createPrivacyRequest({
      workspaceId: body.workspace_id,
      projectId: body.project_id ?? null,
      actorSubjectId: body.actor_subject_id,
      requestType: body.request_type,
      targetMemoryId: body.target_memory_id ?? null,
      reason: body.reason,
      correctionText: body.correction_text ?? null,
      idempotencyKey: body.idempotency_key,
    });
    return c.json(
      {
        ...request,
        actor: resolveSeedActor(request.actorSubjectId),
        backend: 'memory-store',
      },
      201,
    );
  });

  app.get('/v1/memories/:id', async (c) => {
    const memoryId = c.req.param('id');
    const authz = c.get('authz');
    const gw = c.get('gateway');
    if (gw) {
      try {
        const memory = await gw.getMemory({
          subjectId: authz.subjectId,
          memoryId,
        });
        return c.json({ memory, backend: 'supabase' });
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        const message = (err as Error).message;
        if (/not found|P0002/i.test(message)) {
          return c.json({ error: 'memory not found' }, 404);
        }
        return c.json({ error: message }, 500);
      }
    }
    const memory = c.get('store').memories.get(memoryId);
    if (!memory) return c.json({ error: 'memory not found' }, 404);
    if (
      !authorize(authz, {
        resourceType: 'memory',
        action: 'read',
        projectId: memory.projectId,
        sensitivity: memory.sensitivity,
      })
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }
    return c.json({
      memory: buildLocalMemoryDetail(memory),
      backend: 'memory-store',
    });
  });

  app.post('/v1/memories', async (c) => {
    const body = createDecisionSchema.parse(await c.req.json());
    if (!body.project_id) return missingProjectResponse(c);
    const authz = c.get('authz');
    if (
      !authorize(authz, {
        resourceType: 'memory',
        action: 'write',
        projectId: body.project_id,
        sensitivity: body.sensitivity,
      })
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }

    const gw = c.get('gateway');
    if (gw) {
      try {
        const memory = await gw.createDecision({
          subjectId: body.actor_subject_id,
          workspaceId: body.workspace_id,
          projectId: body.project_id,
          title: body.title,
          content: body.content,
          idempotencyKey: body.idempotency_key,
          importance: body.importance,
          confidence: body.confidence,
          sensitivity: body.sensitivity,
          rationale: body.rationale,
        });
        return c.json(memory, 201);
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }

    const memory = c.get('store').createDecision({
      workspaceId: body.workspace_id,
      projectId: body.project_id,
      title: body.title,
      content: body.content,
      actorSubjectId: body.actor_subject_id,
      idempotencyKey: body.idempotency_key,
      importance: body.importance,
      confidence: body.confidence,
      sensitivity: body.sensitivity,
    });
    return c.json(memory, 201);
  });

  app.post('/v1/consolidation/run', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      workspace_id?: string;
      actor_subject_id?: string;
      apply?: boolean;
      limit?: number;
      enqueue?: boolean;
    };
    const authz = c.get('authz');
    if (!authz.isOwner) return c.json({ error: 'forbidden' }, 403);
    const workspaceId = body.workspace_id ?? seedWorkspace;
    const actorSubjectId = body.actor_subject_id ?? authz.subjectId;
    if (authz.subjectId !== actorSubjectId) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const apply = body.apply !== false;
    const gw = c.get('gateway');
    try {
      if (gw) {
        let jobMeta: {
          jobId: string;
          eventId: string;
          idempotencyKey: string;
        } | null = null;
        if (body.enqueue) {
          jobMeta = await gw.enqueueConsolidation({
            subjectId: actorSubjectId,
            workspaceId,
          });
        }
        const rows = await gw.listMemories({
          subjectId: actorSubjectId,
          workspaceId,
          status: 'candidate',
          limit: body.limit ?? 100,
        });
        const planned = await planCandidateConsolidations(
          rows.map((row) => ({
            id: row.id,
            title: row.title,
            content: row.content,
            status: row.status,
            recordedAt: row.recordedAt,
            embedding: Array.isArray(row.embedding) ? row.embedding : null,
          })),
        );
        const applied = [];
        const failed = [];
        if (apply) {
          for (const pair of planned) {
            try {
              applied.push(
                await gw.supersedeMemory({
                  subjectId: actorSubjectId,
                  duplicateId: pair.duplicateId,
                  keeperId: pair.keeperId,
                  reason: `consolidation: ${pair.reason}`,
                }),
              );
            } catch (err) {
              failed.push({
                pair,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
        if (jobMeta) {
          const status =
            failed.length > 0 && applied.length === 0 ? 'failed' : 'succeeded';
          await gw.completeConsolidation({
            subjectId: actorSubjectId,
            jobId: jobMeta.jobId,
            status,
            error:
              status === 'failed'
                ? failed
                    .map((f) =>
                      typeof f === 'object' && f && 'error' in f
                        ? String((f as { error: string }).error)
                        : 'failed',
                    )
                    .join('; ')
                    .slice(0, 500)
                : null,
          });
        }
        return c.json({
          scanned: rows.length,
          planned: planned.length,
          pairs: planned,
          applied,
          failed,
          backend: 'supabase',
          job: jobMeta,
        });
      }

      const storeLocal = c.get('store');
      const candidates = [...storeLocal.memories.values()]
        .filter((m) => m.status === 'candidate')
        .map((m) => ({
          id: m.id,
          title: m.title,
          content: m.content,
          status: m.status,
          recordedAt: m.recordedAt,
        }));
      const planned = await planCandidateConsolidations(candidates);
      const applied = [];
      if (apply) {
        for (const pair of planned) {
          applied.push(
            storeLocal.supersedeMemory({
              duplicateId: pair.duplicateId,
              keeperId: pair.keeperId,
              reason: `consolidation: ${pair.reason}`,
              actorSubjectId,
            }),
          );
        }
      }
      return c.json({
        scanned: candidates.length,
        planned: planned.length,
        pairs: planned,
        applied,
        failed: [],
        backend: 'memory-store',
      });
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/memories/:id/status', async (c) => {
    const memoryId = c.req.param('id');
    const body = setMemoryStatusSchema.parse(await c.req.json());
    const authz = c.get('authz');
    if (!authz.isOwner && body.status !== 'disputed') {
      return c.json({ error: 'forbidden' }, 403);
    }
    if (!authz.isOwner && authz.subjectId !== body.actor_subject_id) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const gw = c.get('gateway');
    if (gw) {
      try {
        const result = await gw.setMemoryStatus({
          subjectId: body.actor_subject_id,
          memoryId,
          status: body.status,
          reason: body.reason,
        });
        return c.json(result);
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }
    try {
      const updated = c.get('store').setMemoryStatus({
        memoryId,
        status: body.status,
        reason: body.reason,
        actorSubjectId: body.actor_subject_id,
      });
      return c.json({
        id: updated.id,
        status: updated.status,
        projectId: updated.projectId,
        title: updated.title,
        reason: body.reason,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  app.patch('/v1/memories/:id', async (c) => {
    const memoryId = c.req.param('id');
    const rawBody = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof rawBody.reason !== 'string' || rawBody.reason.trim() === '') {
      return c.json({ error: 'reason required' }, 400);
    }
    const parsed = correctMemorySchema.safeParse(rawBody);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message ?? 'invalid request';
      return c.json({ error: firstIssue }, 400);
    }
    const body = parsed.data;
    const authz = c.get('authz');
    if (!authz.isOwner) {
      return c.json({ error: 'forbidden' }, 403);
    }
    if (authz.subjectId !== body.actor_subject_id) {
      return c.json({ error: 'forbidden' }, 403);
    }

    const gw = c.get('gateway');
    if (gw) {
      try {
        const result = await gw.correctMemory({
          subjectId: body.actor_subject_id,
          memoryId,
          reason: body.reason,
          title: body.title,
          content: body.content,
          replacementMemoryId: body.replacement_memory_id,
        });
        return c.json(result);
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        if (isNotFoundError(err)) return c.json({ error: (err as Error).message }, 404);
        return c.json({ error: (err as Error).message }, 400);
      }
    }

    try {
      const result = c.get('store').correctMemory({
        memoryId,
        reason: body.reason,
        actorSubjectId: body.actor_subject_id,
        title: body.title,
        content: body.content,
        replacementMemoryId: body.replacement_memory_id,
      });
      return c.json({
        supersededId: result.superseded.id,
        authoritativeId: result.authoritative.id,
        supersededStatus: result.superseded.status,
        authoritativeStatus: result.authoritative.status,
        reason: body.reason,
        projectId: result.authoritative.projectId,
        title: result.authoritative.title,
      });
    } catch (err) {
      if (isNotFoundError(err)) return c.json({ error: (err as Error).message }, 404);
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post('/v1/memories/embed-missing', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      workspace_id?: string;
      actor_subject_id?: string;
      status?: string | null;
      limit?: number;
    };
    const authz = c.get('authz');
    if (!authz.isOwner) return c.json({ error: 'forbidden' }, 403);
    const actorSubjectId = body.actor_subject_id ?? authz.subjectId;
    if (authz.subjectId !== actorSubjectId) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({ error: 'supabase gateway required for embed persist' }, 501);
    }
    const limit = Math.min(Math.max(Number(body.limit ?? 25) || 25, 1), 100);
    try {
      const rows = await gw.listMemories({
        subjectId: actorSubjectId,
        workspaceId: body.workspace_id ?? seedWorkspace,
        status: body.status ?? null,
        limit: 200,
      });
      const missing = rows.filter(
        (row) => !Array.isArray(row.embedding) || row.embedding.length === 0,
      );
      const batch = missing.slice(0, limit);
      const embedded: Array<{
        memoryId: string;
        dims: number;
        engine: string;
      }> = [];
      const failed: Array<{ memoryId: string; error: string }> = [];
      for (const row of batch) {
        try {
          // list_memories truncates content — fetch full text for quality embed
          const full = await gw.getMemory({
            subjectId: actorSubjectId,
            memoryId: row.id,
          });
          const vec = await embedMemoryText(full.title, full.content);
          if (vec.vector.length === 0) {
            failed.push({ memoryId: row.id, error: 'empty embedding vector' });
            continue;
          }
          const saved = await gw.setMemoryEmbedding({
            subjectId: actorSubjectId,
            memoryId: row.id,
            embedding: vec.vector,
            engine: vec.engine,
          });
          embedded.push({
            memoryId: row.id,
            dims: saved.dims,
            engine: saved.engine ?? vec.engine,
          });
        } catch (err) {
          failed.push({
            memoryId: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return c.json({
        scanned: rows.length,
        missing: missing.length,
        embedded: embedded.length,
        failed,
        results: embedded,
        backend: 'supabase',
      });
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/memories/:id/embed', async (c) => {
    const memoryId = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as {
      workspace_id?: string;
      actor_subject_id?: string;
      title?: string;
      text?: string;
    };
    const authz = c.get('authz');
    if (!authz.isOwner) return c.json({ error: 'forbidden' }, 403);
    const actorSubjectId = body.actor_subject_id ?? authz.subjectId;
    if (authz.subjectId !== actorSubjectId) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({ error: 'supabase gateway required for embed persist' }, 501);
    }
    try {
      let title = body.title?.trim() || '';
      let text = body.text?.trim() || '';
      if (!title || !text) {
        const hit = await gw.getMemory({
          subjectId: actorSubjectId,
          memoryId,
        });
        title = title || hit.title;
        text = text || hit.content;
      }
      const embedded = await embedMemoryText(title, text);
      if (embedded.vector.length === 0) {
        return c.json({ error: 'empty embedding vector', engine: embedded.engine }, 422);
      }
      const result = await gw.setMemoryEmbedding({
        subjectId: actorSubjectId,
        memoryId,
        embedding: embedded.vector,
        engine: embedded.engine,
      });
      return c.json({ ...result, backend: 'supabase' });
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/v1/projects', async (c) => {
    const authz = c.get('authz');
    const workspaceId = c.req.query('workspace_id') ?? seedWorkspace;
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({
        projects: [
          {
            id: seedProject,
            slug: 'aistroyka',
            name: 'AISTROYKA',
            status: 'active',
            url: 'https://github.com/aistroyka/core',
          },
        ],
        backend: 'memory-store',
      });
    }
    try {
      const projects = await gw.listProjects(authz.subjectId, workspaceId);
      return c.json({ projects });
    } catch (err) {
      if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/v1/projects/:id/context', async (c) => {
    const projectId = c.req.param('id');
    const authz = c.get('authz');
    if (
      !authorize(authz, {
        resourceType: 'memory',
        action: 'read',
        projectId,
        sensitivity: 'internal',
      })
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }

    const gw = c.get('gateway');
    if (gw) {
      try {
        const ctx = await gw.projectContext(authz.subjectId, projectId);
        return c.json(ctx);
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }

    return c.json(projectContext([...c.get('store').memories.values()], projectId));
  });

  app.get('/v1/projects/:id/state', async (c) => {
    const projectId = c.req.param('id');
    const authz = c.get('authz');
    if (
      !authorize(authz, {
        resourceType: 'project_state',
        action: 'read',
        projectId,
      })
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }

    const gw = c.get('gateway');
    if (gw) {
      try {
        const ctx = (await gw.projectContext(authz.subjectId, projectId)) as {
          state?: unknown;
        };
        return c.json(ctx.state ?? null);
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }

    return c.json(c.get('store').getProjectState(projectId));
  });

  app.patch('/v1/projects/:id/state', async (c) => {
    const projectId = c.req.param('id');
    const body = upsertProjectStateSchema.parse(await c.req.json());
    const authz = c.get('authz');
    if (
      !authorize(authz, {
        resourceType: 'project_state',
        action: 'write',
        projectId,
      })
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const gw = c.get('gateway');
    if (gw) {
      try {
        const state = await gw.upsertProjectState({
          subjectId: body.actor_subject_id,
          workspaceId: body.workspace_id,
          projectId,
          expectedVersion: body.expected_version,
          state: body.state,
          summary: body.summary,
        });
        return c.json(state);
      } catch (err) {
        const message = (err as Error).message;
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        if (/conflict|40001/i.test(message)) {
          return c.json({ error: message }, 409);
        }
        return c.json({ error: message }, 500);
      }
    }

    try {
      const state = c.get('store').upsertProjectState({
        workspaceId: body.workspace_id,
        projectId,
        expectedVersion: body.expected_version,
        state: body.state,
        summary: body.summary,
        actorSubjectId: body.actor_subject_id,
      });
      return c.json(state);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409);
    }
  });

  app.get('/v1/handoffs', async (c) => {
    const authz = c.get('authz');
    const workspaceId = c.req.query('workspace_id') ?? seedWorkspace;
    const projectId = c.req.query('project_id') ?? null;
    const limit = Number(c.req.query('limit') ?? '50');
    const gw = c.get('gateway');
    if (gw) {
      try {
        const handoffs = await gw.listHandoffs({
          subjectId: authz.subjectId,
          workspaceId,
          projectId,
          limit: Number.isFinite(limit) ? limit : 50,
        });
        return c.json(handoffs);
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }
    const handoffs = c
      .get('store')
      .listHandoffs(projectId, Number.isFinite(limit) ? limit : 50)
      .filter(
        (handoff) =>
          handoff.workspaceId === workspaceId &&
          authorize(authz, {
            resourceType: 'handoff',
            action: 'read',
            projectId: handoff.projectId,
          }),
      );
    return c.json({ handoffs, backend: 'memory-store' });
  });

  app.post('/v1/handoffs', async (c) => {
    const body = createHandoffSchema.parse(await c.req.json());
    if (!body.project_id) return missingProjectResponse(c);
    const authz = c.get('authz');
    if (
      !authorize(authz, {
        resourceType: 'handoff',
        action: 'write',
        projectId: body.project_id,
      })
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }

    const gw = c.get('gateway');
    if (gw) {
      try {
        const handoff = await gw.createHandoff({
          subjectId: body.from_subject_id,
          workspaceId: body.workspace_id,
          projectId: body.project_id,
          toSubjectId: body.to_subject_id,
          payload: body.payload,
        });
        return c.json(handoff, 201);
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }

    const handoff = c.get('store').createHandoff({
      workspaceId: body.workspace_id,
      projectId: body.project_id,
      fromSubjectId: body.from_subject_id,
      toSubjectId: body.to_subject_id,
      sessionId: body.session_id,
      payload: body.payload,
    });
    return c.json(handoff, 201);
  });

  app.post('/v1/extraction/preview', async (c) => {
    const authz = c.get('authz');
    const body = (await c.req.json().catch(() => ({}))) as {
      title?: string;
      text?: string;
    };
    const text = String(body.text ?? '').trim();
    if (!text) return c.json({ error: 'text is required' }, 400);
    try {
      const result = await createExtractionAdapter().extract({
        title: body.title ? String(body.title) : undefined,
        text,
      });
      return c.json({
        ...result,
        subjectId: authz.subjectId,
        preview: true,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/extraction/run', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      title?: string;
      text?: string;
      workspace_id?: string;
      project_id?: string;
      actor_subject_id?: string;
      apply?: boolean;
      idempotency_prefix?: string;
      sensitivity?: string;
    };
    const text = String(body.text ?? '').trim();
    if (!text) return c.json({ error: 'text is required' }, 400);
    try {
      const preview = await createExtractionAdapter().extract({
        title: body.title ? String(body.title) : undefined,
        text,
      });
      if (!body.apply) {
        return c.json({
          ...preview,
          preview: true,
          applied: false,
        });
      }
      if (!body.project_id) {
        return c.json({ error: 'project_id is required for this write' }, 400);
      }
      // Re-enter apply path via internal request shape.
      const applyBody = applyExtractionSchema.parse({
        workspace_id: body.workspace_id ?? seedWorkspace,
        project_id: body.project_id,
        actor_subject_id: body.actor_subject_id ?? c.get('authz').subjectId,
        sensitivity: body.sensitivity,
        idempotency_prefix:
          body.idempotency_prefix ?? `extract-run-${Date.now()}`,
        candidates: preview.candidates,
      });
      const applyRes = await app.request('/v1/extraction/apply', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-subject-id': applyBody.actor_subject_id,
        },
        body: JSON.stringify(applyBody),
      });
      const applyJson = await applyRes.json();
      if (!applyRes.ok) {
        return c.json(applyJson, applyRes.status as 400 | 403 | 500);
      }
      return c.json({
        ...preview,
        preview: false,
        applied: true,
        apply: applyJson,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/v1/extraction/apply', async (c) => {
    const body = applyExtractionSchema.parse(await c.req.json());
    if (!body.project_id) return missingProjectResponse(c);
    const authz = c.get('authz');
    if (
      !authorize(authz, {
        resourceType: 'memory',
        action: 'write',
        projectId: body.project_id,
        sensitivity: body.sensitivity,
      })
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }

    const gw = c.get('gateway');
    const created: Array<{
      index: number;
      memoryType: string;
      memoryId?: string;
      mode: 'decision' | 'capture';
      error?: string;
    }> = [];

    for (let i = 0; i < body.candidates.length; i += 1) {
      const candidate = body.candidates[i]!;
      const idempotencyKey = `${body.idempotency_prefix}:${i}`;
      try {
        if (candidate.memoryType === 'decision') {
          if (gw) {
            const memory = await gw.createDecision({
              subjectId: body.actor_subject_id,
              workspaceId: body.workspace_id,
              projectId: body.project_id,
              title: candidate.title,
              content: candidate.content,
              idempotencyKey,
              confidence: candidate.confidence,
              sensitivity: body.sensitivity,
            });
            created.push({
              index: i,
              memoryType: candidate.memoryType,
              memoryId: String((memory as { id?: string }).id ?? ''),
              mode: 'decision',
            });
          } else {
            const memory = c.get('store').createDecision({
              workspaceId: body.workspace_id,
              projectId: body.project_id,
              title: candidate.title,
              content: candidate.content,
              actorSubjectId: body.actor_subject_id,
              idempotencyKey,
              confidence: candidate.confidence,
              sensitivity: body.sensitivity,
            });
            created.push({
              index: i,
              memoryType: candidate.memoryType,
              memoryId: memory.id,
              mode: 'decision',
            });
          }
        } else if (gw) {
          const result = await gw.captureText({
            subjectId: body.actor_subject_id,
            workspaceId: body.workspace_id,
            projectId: body.project_id,
            title: candidate.title,
            text: candidate.content,
            idempotencyKey,
            sensitivity: body.sensitivity,
            processNow: true,
          });
          await maybeEmbedCapturedMemory(gw, {
            subjectId: body.actor_subject_id,
            title: candidate.title,
            text: candidate.content,
            captureResult: result as {
              process?: { memoryId?: string | null } | null;
            },
          });
          const memoryId =
            (result as { process?: { memoryId?: string }; memoryId?: string })
              .process?.memoryId ??
            (result as { memoryId?: string }).memoryId;
          created.push({
            index: i,
            memoryType: candidate.memoryType,
            memoryId: memoryId ? String(memoryId) : undefined,
            mode: 'capture',
          });
        } else {
          const result = c.get('store').captureText({
            workspaceId: body.workspace_id,
            projectId: body.project_id,
            title: candidate.title,
            text: candidate.content,
            actorSubjectId: body.actor_subject_id,
            idempotencyKey,
            sensitivity: body.sensitivity,
          });
          created.push({
            index: i,
            memoryType: candidate.memoryType,
            memoryId: result.memoryId,
            mode: 'capture',
          });
        }
      } catch (err) {
        created.push({
          index: i,
          memoryType: candidate.memoryType,
          mode: candidate.memoryType === 'decision' ? 'decision' : 'capture',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const ok = created.filter((row) => !row.error).length;
    return c.json(
      {
        applied: ok,
        failed: created.length - ok,
        items: created,
        backend: gw ? 'supabase' : 'memory-store',
      },
      201,
    );
  });

  app.post('/v1/search', async (c) => {
    const body = await c.req.json<{
      query: string;
      project_id?: string;
      include_history?: boolean;
      recorded_after?: string;
      recorded_before?: string;
      pack_context?: boolean;
      max_context_chars?: number;
    }>();
    const authz = c.get('authz');
    const gw = c.get('gateway');
    const pack = Boolean(body.pack_context);
    if (gw) {
      try {
        let queryEmbedding: number[] | null = null;
        try {
          const adapter = createEmbeddingAdapter();
          const embedded = await adapter.embed({ texts: [body.query ?? ''] });
          if ((embedded.vectors[0]?.length ?? 0) === 32) {
            queryEmbedding = embedded.vectors[0] ?? null;
          }
        } catch {
          queryEmbedding = null;
        }
        const raw = await gw.search({
          subjectId: authz.subjectId,
          query: body.query ?? '',
          projectId: body.project_id,
          includeHistory: body.include_history,
          queryEmbedding,
          recordedAfter: body.recorded_after,
          recordedBefore: body.recorded_before,
        });
        const list = (Array.isArray(raw) ? raw : []) as Array<{
          memory: {
            id?: string | null;
            title?: string | null;
            content?: string | null;
            status?: string | null;
            recordedAt?: string | null;
            recorded_at?: string | null;
            embedding?: number[] | null;
          };
          score: number;
          reason?: string;
        }>;
        const hits = await rerankHitsHybrid(list, body.query ?? '', {
          reason: 'hybrid:rpc+rrf',
          recordedAfter: body.recorded_after,
          recordedBefore: body.recorded_before,
        });
        return c.json({
          hits,
          backend: 'supabase',
          ranking: 'hybrid-rrf',
          queryEmbeddingDims: queryEmbedding?.length ?? 0,
          ...(pack
            ? {
                context: packSearchContext(hits, {
                  maxChars: body.max_context_chars,
                }),
              }
            : {}),
        });
      } catch (err) {
        if (isForbiddenError(err)) return c.json({ error: 'forbidden' }, 403);
        return c.json({ error: (err as Error).message }, 500);
      }
    }

    const storeLocal = c.get('store');
    const allowed = [...storeLocal.memories.values()].filter((m) =>
      authorize(authz, {
        resourceType: 'memory',
        action: 'read',
        projectId: m.projectId,
        sensitivity: m.sensitivity,
      }),
    );
    const hits = await searchMemoriesHybrid(allowed, body.query ?? '', {
      projectId: body.project_id,
      includeHistory: body.include_history,
      recordedAfter: body.recorded_after,
      recordedBefore: body.recorded_before,
    });
    return c.json({
      hits,
      ranking: 'hybrid-rrf',
      ...(pack
        ? {
            context: packSearchContext(hits, {
              maxChars: body.max_context_chars,
            }),
          }
        : {}),
    });
  });

  return app;
}
