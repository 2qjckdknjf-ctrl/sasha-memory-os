import {
  createSeededStore,
  type MemoryStore,
} from '@memory-os/domain';
import {
  createConfiguredVaultStore,
  type SupabaseMemoryGateway,
} from '@memory-os/db';
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
  runConnectorSync,
  type RegisteredConnector,
  type SyncCursor,
} from '@memory-os/connector-sdk';
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
import {
  decodeBase64Document,
  extractTextFromBytes,
  fetchPublicLink,
} from '@memory-os/ingestion';
import {
  applyExtractionSchema,
  captureDocumentSchema,
  captureLinkSchema,
  captureTextSchema,
  createDecisionSchema,
  createHandoffSchema,
  oauthCompleteSchema,
  oauthStartSchema,
  setConnectionStatusSchema,
  setMemoryStatusSchema,
  upsertConnectionSchema,
  type ApplyExtractionInput,
} from '@memory-os/schemas';
import { randomUUID } from 'node:crypto';
import {
  adaptToolSchemaForProfile,
  applyProfileDefaults,
  getMcpProfile,
  isToolAllowed,
  toolAnnotations,
  type McpProfileName,
} from './profile.js';

const DEFAULT_PROJECT_ID = '44444444-4444-4444-8444-444444444401';

const defaultSdkConnectorRegistry = createConnectorRegistry([
  githubConnector,
  gmailConnector,
  googleDriveConnector,
  googleCalendarConnector,
]);

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
  item: {
    connectorId: string;
    connectionId: string;
    displayName?: string;
    vaultRef?: string | null;
  },
  subjectId: string,
  workspaceId: string,
  projectId: string,
  connector: RegisteredConnector<any>,
) {
  const stream = connector.manifest.default_stream ?? connector.manifest.id;
  const vault = createConfiguredVaultStore({ gateway });
  const cursor = toSyncCursor(
    await gateway.getConnectorCursor({
      subjectId,
      accountId: item.connectionId,
      stream,
    }),
  );
  const syncRun = await runConnectorSync({
    connector,
    context: {
      account: {
        connectionId: item.connectionId,
        connectorId: item.connectorId,
        displayName: item.displayName ?? item.connectorId,
        vaultRef: item.vaultRef ?? undefined,
      },
      workspaceId,
      vault,
      cursor,
    },
  });
  let captured = 0;
  for (const record of syncRun.records) {
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
    await maybeEmbedMcpCapture(gateway, {
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
      accountId: item.connectionId,
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

async function maybeEmbedMcpCapture(
  gateway: SupabaseMemoryGateway,
  input: {
    subjectId: string;
    title: string;
    text: string;
    captureResult: { process?: { memoryId?: string | null } | null };
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
    return null;
  }
}

export const packageName = 'mcp-gateway' as const;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
}

export const mcpTools: McpTool[] = [
  {
    name: 'memory.search',
    description:
      'Hybrid RRF search over allowed memories (optional temporal window + packed context)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        project_id: { type: 'string' },
        include_history: { type: 'boolean' },
        recorded_after: { type: 'string' },
        recorded_before: { type: 'string' },
        pack_context: { type: 'boolean' },
        max_context_chars: { type: 'number' },
        actor_subject_id: { type: 'string' },
      },
      required: ['query', 'actor_subject_id'],
    },
  },
  {
    name: 'context.project',
    description: 'Current project context: decisions, tasks, facts',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
      },
      required: ['project_id', 'actor_subject_id'],
    },
  },
  {
    name: 'memory.store_decision',
    description: 'Store a verified decision with idempotency',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        project_id: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        actor_subject_id: { type: 'string' },
        idempotency_key: { type: 'string' },
      },
      required: [
        'workspace_id',
        'project_id',
        'title',
        'content',
        'actor_subject_id',
        'idempotency_key',
      ],
    },
  },
  {
    name: 'handoff.create',
    description: 'Create agent handoff for a project',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        project_id: { type: 'string' },
        from_subject_id: { type: 'string' },
        to_subject_id: { type: 'string' },
        idempotency_key: { type: 'string' },
        payload: { type: 'object' },
      },
      required: [
        'workspace_id',
        'project_id',
        'from_subject_id',
        'idempotency_key',
        'payload',
      ],
    },
  },
  {
    name: 'connections.list',
    description: 'List connector accounts and health for a workspace',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
      },
      required: ['workspace_id', 'actor_subject_id'],
    },
  },
  {
    name: 'connections.upsert',
    description: 'Connect or refresh a connector account',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        connector_id: { type: 'string' },
        display_name: { type: 'string' },
        scopes: { type: 'array', items: { type: 'string' } },
        status: { type: 'string' },
        actor_subject_id: { type: 'string' },
      },
      required: [
        'workspace_id',
        'connector_id',
        'display_name',
        'actor_subject_id',
      ],
    },
  },
  {
    name: 'connections.set_status',
    description: 'Revoke, reauth, or mark a connection degraded',
    inputSchema: {
      type: 'object',
      properties: {
        connection_id: { type: 'string' },
        status: { type: 'string' },
        last_error: { type: 'string' },
        actor_subject_id: { type: 'string' },
      },
      required: ['connection_id', 'status', 'actor_subject_id'],
    },
  },
  {
    name: 'capture.text',
    description: 'Capture plain text into quarantine → candidate memory',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        project_id: { type: 'string' },
        title: { type: 'string' },
        text: { type: 'string' },
        actor_subject_id: { type: 'string' },
        idempotency_key: { type: 'string' },
        process_now: { type: 'boolean' },
      },
      required: [
        'workspace_id',
        'project_id',
        'title',
        'text',
        'actor_subject_id',
        'idempotency_key',
      ],
    },
  },
  {
    name: 'connections.sync',
    description:
      'Enqueue connector_sync jobs, ingest vault-backed or stub deltas, mark jobs done',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        connection_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
        project_id: { type: 'string' },
        complete_now: { type: 'boolean' },
      },
      required: ['workspace_id', 'actor_subject_id'],
    },
  },
  {
    name: 'oauth.start',
    description:
      'Start OAuth broker for a connector (returns authorizeUrl + state)',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        connector_id: { type: 'string' },
        display_name: { type: 'string' },
        scopes: { type: 'array', items: { type: 'string' } },
        redirect_uri: { type: 'string' },
        actor_subject_id: { type: 'string' },
      },
      required: [
        'workspace_id',
        'connector_id',
        'display_name',
        'actor_subject_id',
      ],
    },
  },
  {
    name: 'oauth.callback',
    description:
      'Complete OAuth: peek state → HTTP token exchange into vault → vault ref only in DB',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string' },
        code: { type: 'string' },
        actor_subject_id: { type: 'string' },
      },
      required: ['state', 'actor_subject_id'],
    },
  },
  {
    name: 'consolidation.run',
    description: 'Plan/apply near-duplicate candidate consolidation (owner)',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
        apply: { type: 'boolean' },
        limit: { type: 'number' },
        enqueue: {
          type: 'boolean',
          description: 'Also enqueue consolidate job + outbox event',
        },
      },
      required: ['workspace_id', 'actor_subject_id'],
    },
  },
  {
    name: 'outbox.list_pending',
    description: 'List unpublished outbox events for a workspace (owner ops)',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
        event_type: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['workspace_id', 'actor_subject_id'],
    },
  },
  {
    name: 'jobs.dead_letter_stale',
    description: 'Mark queued/running jobs older than N minutes as dead_letter',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
        older_than_minutes: { type: 'number' },
      },
      required: ['workspace_id', 'actor_subject_id'],
    },
  },
  {
    name: 'outbox.publish',
    description: 'Mark one outbox event as published (ops recovery)',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
        error: { type: 'string' },
      },
      required: ['event_id', 'actor_subject_id'],
    },
  },
  {
    name: 'memory.set_status',
    description: 'Approve/reject/retract/dispute a memory (owner or dispute)',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string' },
        status: { type: 'string' },
        reason: { type: 'string' },
        actor_subject_id: { type: 'string' },
      },
      required: ['memory_id', 'status', 'reason', 'actor_subject_id'],
    },
  },
  {
    name: 'memory.get',
    description: 'Fetch a single memory with full content (ACL-aware)',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
      },
      required: ['memory_id', 'actor_subject_id'],
    },
  },
  {
    name: 'memory.embed',
    description: 'Recompute and persist embedding for a memory (owner)',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string' },
        workspace_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
        title: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['memory_id', 'workspace_id', 'actor_subject_id'],
    },
  },
  {
    name: 'memory.embed_missing',
    description:
      'Embed memories that lack a vector (owner; batch catch-up, default limit 25)',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['workspace_id', 'actor_subject_id'],
    },
  },
  {
    name: 'memory.export',
    description:
      'Owner portable dump of memories (full content; optional recorded_at window)',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
        project_id: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'number' },
        recorded_after: { type: 'string' },
        recorded_before: { type: 'string' },
      },
      required: ['workspace_id', 'actor_subject_id'],
    },
  },
  {
    name: 'jobs.get',
    description: 'Fetch ingestion/processing job status by id',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
      },
      required: ['job_id', 'actor_subject_id'],
    },
  },
  {
    name: 'extraction.preview',
    description:
      'Preview memory extraction candidates from text (does not persist)',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        text: { type: 'string' },
        actor_subject_id: { type: 'string' },
      },
      required: ['text', 'actor_subject_id'],
    },
  },
  {
    name: 'extraction.apply',
    description:
      'Persist extraction candidates as decisions or capture→candidate memories',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        project_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
        sensitivity: { type: 'string' },
        idempotency_prefix: { type: 'string' },
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              content: { type: 'string' },
              memoryType: { type: 'string' },
              confidence: { type: 'number' },
            },
          },
        },
      },
      required: [
        'workspace_id',
        'project_id',
        'actor_subject_id',
        'idempotency_prefix',
        'candidates',
      ],
    },
  },
  {
    name: 'extraction.run',
    description:
      'Extract candidates from text; optionally apply them (apply=true)',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        text: { type: 'string' },
        workspace_id: { type: 'string' },
        project_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
        apply: { type: 'boolean' },
        idempotency_prefix: { type: 'string' },
        sensitivity: { type: 'string' },
      },
      required: ['text', 'actor_subject_id'],
    },
  },
  {
    name: 'capture.document',
    description:
      'Capture TXT/PDF/DOCX/image (OCR) / audio (STT) into candidate memory',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        project_id: { type: 'string' },
        title: { type: 'string' },
        filename: { type: 'string' },
        mime_type: { type: 'string' },
        content_base64: { type: 'string' },
        actor_subject_id: { type: 'string' },
        idempotency_key: { type: 'string' },
        process_now: { type: 'boolean' },
      },
      required: [
        'workspace_id',
        'project_id',
        'title',
        'filename',
        'content_base64',
        'actor_subject_id',
        'idempotency_key',
      ],
    },
  },
  {
    name: 'capture.link',
    description: 'Capture a public URL via SSRF-safe fetch into candidate memory',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        project_id: { type: 'string' },
        url: { type: 'string' },
        title: { type: 'string' },
        actor_subject_id: { type: 'string' },
        idempotency_key: { type: 'string' },
        process_now: { type: 'boolean' },
      },
      required: [
        'workspace_id',
        'project_id',
        'url',
        'actor_subject_id',
        'idempotency_key',
      ],
    },
  },
];

export function createMcpHandlers(options?: {
  store?: MemoryStore;
  gateway?: SupabaseMemoryGateway | null;
  profile?: McpProfileName | string | null;
  connectorRegistry?: ConnectorRegistry;
}) {
  const store = options?.store ?? createSeededStore();
  const gateway = options?.gateway ?? null;
  const profile = getMcpProfile(options?.profile);
  const connectorRegistry = options?.connectorRegistry ?? defaultSdkConnectorRegistry;
  const tools: McpTool[] = mcpTools
    .filter((tool) => isToolAllowed(profile, tool.name))
    .map((tool) => ({
      ...tool,
      inputSchema: adaptToolSchemaForProfile(profile, tool.inputSchema),
      annotations: toolAnnotations(tool.name),
    }));


  async function applyExtraction(input: ApplyExtractionInput) {
    const created: Array<{
      index: number;
      memoryType: string;
      memoryId?: string;
      mode: 'decision' | 'capture';
      error?: string;
    }> = [];
    for (let i = 0; i < input.candidates.length; i += 1) {
      const candidate = input.candidates[i]!;
      const idempotencyKey = `${input.idempotency_prefix}:${i}`;
      try {
        if (candidate.memoryType === 'decision') {
          if (gateway) {
            const memory = await gateway.createDecision({
              subjectId: input.actor_subject_id,
              workspaceId: input.workspace_id,
              projectId: input.project_id,
              title: candidate.title,
              content: candidate.content,
              idempotencyKey,
              confidence: candidate.confidence,
              sensitivity: input.sensitivity,
            });
            created.push({
              index: i,
              memoryType: candidate.memoryType,
              memoryId: String((memory as { id?: string }).id ?? ''),
              mode: 'decision',
            });
          } else {
            const memory = store.createDecision({
              workspaceId: input.workspace_id,
              projectId: input.project_id,
              title: candidate.title,
              content: candidate.content,
              actorSubjectId: input.actor_subject_id,
              idempotencyKey,
              confidence: candidate.confidence,
              sensitivity: input.sensitivity,
            });
            created.push({
              index: i,
              memoryType: candidate.memoryType,
              memoryId: memory.id,
              mode: 'decision',
            });
          }
        } else if (gateway) {
          const captureResult = await gateway.captureText({
            subjectId: input.actor_subject_id,
            workspaceId: input.workspace_id,
            projectId: input.project_id,
            title: candidate.title,
            text: candidate.content,
            idempotencyKey,
            sensitivity: input.sensitivity,
            processNow: true,
          });
          await maybeEmbedMcpCapture(gateway, {
            subjectId: input.actor_subject_id,
            title: candidate.title,
            text: candidate.content,
            captureResult,
          });
          const memoryId =
            captureResult.process?.memoryId ??
            (captureResult as { memoryId?: string }).memoryId;
          created.push({
            index: i,
            memoryType: candidate.memoryType,
            memoryId: memoryId ? String(memoryId) : undefined,
            mode: 'capture',
          });
        } else {
          const result = store.captureText({
            workspaceId: input.workspace_id,
            projectId: input.project_id,
            title: candidate.title,
            text: candidate.content,
            actorSubjectId: input.actor_subject_id,
            idempotencyKey,
            sensitivity: input.sensitivity,
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
    return {
      applied: ok,
      failed: created.length - ok,
      items: created,
      backend: gateway ? ('supabase' as const) : ('memory-store' as const),
    };
  }

  return {
    tools,
    profile: profile.name,
    instructions: profile.instructions,
    backend: gateway ? ('supabase' as const) : ('memory-store' as const),
    async call(name: string, rawArgs: Record<string, unknown>) {
      if (!isToolAllowed(profile, name)) {
        throw new Error(
          `Tool ${name} is not available on MCP profile '${profile.name}'`,
        );
      }
      const args = applyProfileDefaults(profile, rawArgs);
      switch (name) {
        case 'memory.search': {
          const query = String(args.query ?? '');
          const recordedAfter = args.recorded_after
            ? String(args.recorded_after)
            : undefined;
          const recordedBefore = args.recorded_before
            ? String(args.recorded_before)
            : undefined;
          const pack = Boolean(args.pack_context);
          const maxContextChars =
            typeof args.max_context_chars === 'number'
              ? args.max_context_chars
              : undefined;
          if (gateway) {
            let queryEmbedding: number[] | null = null;
            try {
              const adapter = createEmbeddingAdapter();
              const embedded = await adapter.embed({ texts: [query] });
              if ((embedded.vectors[0]?.length ?? 0) === 32) {
                queryEmbedding = embedded.vectors[0] ?? null;
              }
            } catch {
              queryEmbedding = null;
            }
            const raw = await gateway.search({
              subjectId: String(args.actor_subject_id),
              query,
              projectId: args.project_id ? String(args.project_id) : undefined,
              includeHistory: Boolean(args.include_history),
              queryEmbedding,
              recordedAfter,
              recordedBefore,
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
            const hits = await rerankHitsHybrid(list, query, {
              reason: 'hybrid:rpc+rrf',
              recordedAfter,
              recordedBefore,
            });
            return {
              hits,
              ranking: 'hybrid-rrf',
              ...(pack
                ? { context: packSearchContext(hits, { maxChars: maxContextChars }) }
                : {}),
            };
          }
          const hits = await searchMemoriesHybrid(
            [...store.memories.values()],
            query,
            {
              projectId: args.project_id ? String(args.project_id) : undefined,
              includeHistory: Boolean(args.include_history),
              recordedAfter,
              recordedBefore,
            },
          );
          return {
            hits,
            ranking: 'hybrid-rrf',
            ...(pack
              ? { context: packSearchContext(hits, { maxChars: maxContextChars }) }
              : {}),
          };
        }
        case 'context.project': {
          const projectId = String(args.project_id);
          if (gateway) {
            return gateway.projectContext(String(args.actor_subject_id), projectId);
          }
          return {
            ...projectContext([...store.memories.values()], projectId),
            state: store.getProjectState(projectId),
            latest_handoff: store.latestHandoff(projectId),
          };
        }
        case 'memory.store_decision': {
          const input = createDecisionSchema.parse(args);
          if (gateway) {
            return gateway.createDecision({
              subjectId: input.actor_subject_id,
              workspaceId: input.workspace_id,
              projectId: input.project_id,
              title: input.title,
              content: input.content,
              idempotencyKey: input.idempotency_key,
              importance: input.importance,
              confidence: input.confidence,
              sensitivity: input.sensitivity,
            });
          }
          return store.createDecision({
            workspaceId: input.workspace_id,
            projectId: input.project_id,
            title: input.title,
            content: input.content,
            actorSubjectId: input.actor_subject_id,
            idempotencyKey: input.idempotency_key,
            importance: input.importance,
            confidence: input.confidence,
            sensitivity: input.sensitivity,
          });
        }
        case 'handoff.create': {
          const input = createHandoffSchema.parse(args);
          if (gateway) {
            return gateway.createHandoff({
              subjectId: input.from_subject_id,
              workspaceId: input.workspace_id,
              projectId: input.project_id,
              toSubjectId: input.to_subject_id,
              payload: input.payload,
            });
          }
          return store.createHandoff({
            workspaceId: input.workspace_id,
            projectId: input.project_id,
            fromSubjectId: input.from_subject_id,
            toSubjectId: input.to_subject_id,
            sessionId: input.session_id,
            payload: input.payload,
          });
        }
        case 'connections.list': {
          if (!gateway) {
            return {
              connections: [
                {
                  connectorId: 'github',
                  displayName: 'AISTROYKA repos',
                  status: 'connected',
                },
              ],
            };
          }
          return {
            connections: await gateway.listConnections(
              String(args.actor_subject_id),
              String(args.workspace_id),
            ),
          };
        }
        case 'connections.upsert': {
          const input = upsertConnectionSchema.parse(args);
          if (!gateway) {
            return {
              id: crypto.randomUUID(),
              connectorId: input.connector_id,
              displayName: input.display_name,
              status: input.status,
              scopes: input.scopes,
            };
          }
          return gateway.upsertConnection({
            subjectId: input.actor_subject_id,
            workspaceId: input.workspace_id,
            connectorId: input.connector_id,
            displayName: input.display_name,
            scopes: input.scopes,
            status: input.status,
          });
        }
        case 'connections.set_status': {
          const input = setConnectionStatusSchema.parse({
            status: args.status,
            last_error: args.last_error,
            actor_subject_id: args.actor_subject_id,
          });
          if (!gateway) {
            return {
              id: String(args.connection_id),
              status: input.status,
              lastError: input.last_error ?? null,
            };
          }
          return gateway.setConnectionStatus({
            subjectId: input.actor_subject_id,
            connectionId: String(args.connection_id),
            status: input.status,
            lastError: input.last_error,
          });
        }
        case 'capture.text': {
          const input = captureTextSchema.parse(args);
          if (gateway) {
            const result = await gateway.captureText({
              subjectId: input.actor_subject_id,
              workspaceId: input.workspace_id,
              projectId: input.project_id,
              title: input.title,
              text: input.text,
              idempotencyKey: input.idempotency_key,
              sensitivity: input.sensitivity,
              processNow: input.process_now,
            });
            const embedding = await maybeEmbedMcpCapture(gateway, {
              subjectId: input.actor_subject_id,
              title: input.title,
              text: input.text,
              captureResult: result,
            });
            return { ...result, embedding };
          }
          return store.captureText({
            workspaceId: input.workspace_id,
            projectId: input.project_id,
            title: input.title,
            text: input.text,
            actorSubjectId: input.actor_subject_id,
            idempotencyKey: input.idempotency_key,
            sensitivity: input.sensitivity,
          });
        }
        case 'oauth.start': {
          const input = oauthStartSchema.parse(args);
          const authorizeBase = resolveAuthorizeBase(input.connector_id);
          if (!gateway) {
            const state = randomUUID().replace(/-/g, '');
            return {
              state,
              connectionId: randomUUID(),
              authorizeUrl: `stub://oauth/${input.connector_id}?state=${state}`,
              backend: 'memory-store',
            };
          }
          return {
            ...(await gateway.oauthStart({
              subjectId: input.actor_subject_id,
              workspaceId: input.workspace_id,
              connectorId: input.connector_id,
              displayName: input.display_name,
              scopes: input.scopes,
              redirectUri: input.redirect_uri,
              authorizeBase,
            })),
            backend: 'supabase',
          };
        }
        case 'oauth.callback': {
          const input = oauthCompleteSchema.parse(args);
          const code = input.code ?? '';
          const codeFingerprint = fingerprintAuthorizationCode(code);
          if (!gateway) {
            return {
              status: 'connected',
              tokenPersisted: false,
              vaultRef: `vault:local/connectors/stub/${input.state}`,
              exchangeMode: 'stub',
              codeFingerprint,
              backend: 'memory-store',
            };
          }
          const peeked = await gateway.oauthPeekState({
            subjectId: input.actor_subject_id,
            state: input.state,
          });
          const vault = createConfiguredVaultStore({ gateway });
          const exchange = await exchangeAuthorizationCode({
            connectorId: peeked.connectorId,
            connectionId: peeked.connectionId,
            code,
            redirectUri: peeked.redirectUri,
            vault,
          });
          const result = await gateway.oauthCompleteStub({
            subjectId: input.actor_subject_id,
            state: input.state,
            codeFingerprint: exchange.codeFingerprint ?? codeFingerprint,
            exchangeMode: exchange.exchangeMode,
          });
          return {
            ...result,
            vaultRef: exchange.vaultRef,
            tokenPersisted: false,
            exchangeMode: exchange.exchangeMode,
            codeFingerprint: exchange.codeFingerprint,
            clientIdConfigured: exchange.clientIdConfigured,
            clientSecretConfigured: exchange.clientSecretConfigured,
            backend: 'supabase',
          };
        }
        case 'connections.sync': {
          if (!gateway) {
            return {
              count: 0,
              enqueued: [],
              completed: [],
              captured: 0,
              backend: 'memory-store',
              note: 'connector sync requires supabase backend',
            };
          }
          const subjectId = String(args.actor_subject_id);
          const workspaceId = String(args.workspace_id);
          const projectId = args.project_id
            ? String(args.project_id)
            : DEFAULT_PROJECT_ID;
          const completeNow = args.complete_now !== false;
          const result = await gateway.enqueueConnectorSync({
            subjectId,
            workspaceId,
            connectionId: args.connection_id
              ? String(args.connection_id)
              : null,
          });
          const completed: Array<Record<string, unknown>> = [];
          let captured = 0;
          if (completeNow) {
            for (const item of result.enqueued ?? []) {
              if (!item.jobId) continue;
              try {
                const sdkConnector = connectorRegistry.get(item.connectorId);
                let pullMode = 'none';
                let note = 'unsupported connector';
                if (sdkConnector) {
                  const ingested = await ingestSdkConnectorDelta(
                    gateway,
                    item,
                    subjectId,
                    workspaceId,
                    projectId,
                    sdkConnector,
                  );
                  captured += ingested.captured;
                  pullMode = ingested.pullMode;
                  note = ingested.note;
                }
                const outcome = resolveConnectorSyncOutcome({ pullMode, note });
                completed.push({
                  ...(await gateway.completeConnectorSync({
                    subjectId,
                    jobId: item.jobId,
                    status: outcome.status,
                    error: outcome.error,
                  })),
                  pullMode,
                  note,
                });
              } catch (err) {
                completed.push(
                  await gateway.completeConnectorSync({
                    subjectId,
                    jobId: item.jobId,
                    status: 'failed',
                    error: err instanceof Error ? err.message : String(err),
                  }),
                );
              }
            }
          }
          return { ...result, completed, captured };
        }
        case 'consolidation.run': {
          const subjectId = String(args.actor_subject_id);
          const workspaceId = String(args.workspace_id);
          const apply = args.apply !== false;
          if (!gateway) {
            const candidates = [...store.memories.values()]
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
                  store.supersedeMemory({
                    duplicateId: pair.duplicateId,
                    keeperId: pair.keeperId,
                    reason: `consolidation: ${pair.reason}`,
                    actorSubjectId: subjectId,
                  }),
                );
              }
            }
            return {
              scanned: candidates.length,
              planned: planned.length,
              pairs: planned,
              applied,
              backend: 'memory-store',
            };
          }
          let jobMeta: {
            jobId: string;
            eventId: string;
            idempotencyKey: string;
          } | null = null;
          if (args.enqueue) {
            jobMeta = await gateway.enqueueConsolidation({
              subjectId,
              workspaceId,
            });
          }
          const rows = await gateway.listMemories({
            subjectId,
            workspaceId,
            status: 'candidate',
            limit: typeof args.limit === 'number' ? args.limit : 100,
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
                  await gateway.supersedeMemory({
                    subjectId,
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
            await gateway.completeConsolidation({
              subjectId,
              jobId: jobMeta.jobId,
              status,
              error:
                status === 'failed'
                  ? failed
                      .map((f) => String(f.error))
                      .join('; ')
                      .slice(0, 500)
                  : null,
            });
          }
          return {
            scanned: rows.length,
            planned: planned.length,
            pairs: planned,
            applied,
            failed,
            backend: 'supabase',
            job: jobMeta,
          };
        }
        case 'outbox.list_pending': {
          if (!gateway) {
            return { count: 0, events: [], backend: 'memory-store' };
          }
          return {
            ...(await gateway.listOutboxPending({
              subjectId: String(args.actor_subject_id),
              workspaceId: String(args.workspace_id),
              eventType: args.event_type ? String(args.event_type) : null,
              limit: typeof args.limit === 'number' ? args.limit : 50,
            })),
            backend: 'supabase',
          };
        }
        case 'jobs.dead_letter_stale': {
          if (!gateway) {
            return {
              deadLettered: 0,
              backend: 'memory-store',
              note: 'dead-letter requires supabase backend',
            };
          }
          return {
            ...(await gateway.deadLetterStaleJobs({
              subjectId: String(args.actor_subject_id),
              workspaceId: String(args.workspace_id),
              olderThanMinutes:
                typeof args.older_than_minutes === 'number'
                  ? args.older_than_minutes
                  : 60,
            })),
            backend: 'supabase',
          };
        }
        case 'outbox.publish': {
          if (!gateway) {
            return {
              id: String(args.event_id),
              publishedAt: new Date().toISOString(),
              backend: 'memory-store',
            };
          }
          return {
            ...(await gateway.publishOutboxEvent({
              subjectId: String(args.actor_subject_id),
              eventId: String(args.event_id),
              error: args.error ? String(args.error) : null,
            })),
            backend: 'supabase',
          };
        }
        case 'memory.get': {
          const memoryId = String(args.memory_id);
          const subjectId = String(args.actor_subject_id);
          if (gateway) {
            return {
              memory: await gateway.getMemory({ subjectId, memoryId }),
              backend: 'supabase',
            };
          }
          const memory = store.memories.get(memoryId);
          if (!memory) throw new Error('memory not found');
          return {
            memory: {
              id: memory.id,
              title: memory.title,
              content: memory.content,
              status: memory.status,
              sensitivity: memory.sensitivity,
              memoryType: memory.memoryType,
              projectId: memory.projectId,
              recordedAt: memory.recordedAt,
              metadata: memory.metadata,
            },
            backend: 'memory-store',
          };
        }
        case 'memory.embed': {
          if (!gateway) {
            return {
              error: 'supabase gateway required for embed persist',
              backend: 'memory-store',
            };
          }
          const memoryId = String(args.memory_id);
          const subjectId = String(args.actor_subject_id);
          if (!args.workspace_id) {
            throw new Error('workspace_id is required');
          }
          let title = args.title ? String(args.title) : '';
          let text = args.text ? String(args.text) : '';
          if (!title || !text) {
            const hit = await gateway.getMemory({ subjectId, memoryId });
            title = title || hit.title;
            text = text || hit.content;
          }
          const embedded = await embedMemoryText(title, text);
          if (embedded.vector.length === 0) {
            throw new Error('empty embedding vector');
          }
          return {
            ...(await gateway.setMemoryEmbedding({
              subjectId,
              memoryId,
              embedding: embedded.vector,
              engine: embedded.engine,
            })),
            backend: 'supabase',
          };
        }
        case 'memory.export': {
          const subjectId = String(args.actor_subject_id);
          const workspaceId = String(args.workspace_id);
          const ownerId = '33333333-3333-4333-8333-333333333301';
          if (subjectId !== ownerId) {
            throw new Error('memory.export requires owner actor');
          }
          const limit = Math.min(
            Math.max(Number(args.limit ?? 200) || 200, 1),
            500,
          );
          const recordedAfter = args.recorded_after
            ? String(args.recorded_after)
            : null;
          const recordedBefore = args.recorded_before
            ? String(args.recorded_before)
            : null;
          const exportedAt = new Date().toISOString();
          if (gateway) {
            const listed = await gateway.listMemories({
              subjectId,
              workspaceId,
              projectId: args.project_id ? String(args.project_id) : null,
              status: args.status ? String(args.status) : null,
              limit,
              recordedAfter,
              recordedBefore,
            });
            const memories = [];
            for (const row of listed) {
              memories.push(
                await gateway.getMemory({ subjectId, memoryId: row.id }),
              );
            }
            return {
              format: 'memory-os.export.memories.v1',
              exportedAt,
              workspaceId,
              subjectId,
              count: memories.length,
              memories,
              recordedAfter,
              recordedBefore,
              backend: 'supabase',
            };
          }
          const memories = [...store.memories.values()]
            .filter((m) => {
              if (args.project_id && m.projectId !== String(args.project_id)) {
                return false;
              }
              if (args.status && m.status !== String(args.status)) return false;
              if (recordedAfter && m.recordedAt < recordedAfter) return false;
              if (recordedBefore && m.recordedAt > recordedBefore) return false;
              return true;
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
          return {
            format: 'memory-os.export.memories.v1',
            exportedAt,
            workspaceId,
            subjectId,
            count: memories.length,
            memories,
            recordedAfter,
            recordedBefore,
            backend: 'memory-store',
          };
        }
        case 'jobs.get': {
          const jobId = String(args.job_id);
          const subjectId = String(args.actor_subject_id);
          if (!gateway) {
            return { id: jobId, status: 'succeeded', backend: 'memory-store' };
          }
          const job = await gateway.getJob(subjectId, jobId);
          if (!job) throw new Error('job not found');
          return { job, backend: 'supabase' };
        }
        case 'extraction.preview': {
          const text = String(args.text ?? '').trim();
          if (!text) throw new Error('text is required');
          const result = await createExtractionAdapter().extract({
            title: args.title ? String(args.title) : undefined,
            text,
          });
          return {
            ...result,
            actor_subject_id: String(args.actor_subject_id),
            preview: true,
          };
        }
        case 'extraction.apply': {
          return applyExtraction(applyExtractionSchema.parse(args));
        }
        case 'extraction.run': {
          const text = String(args.text ?? '').trim();
          if (!text) throw new Error('text is required');
          const preview = await createExtractionAdapter().extract({
            title: args.title ? String(args.title) : undefined,
            text,
          });
          const apply = Boolean(args.apply);
          if (!apply) {
            return {
              ...preview,
              actor_subject_id: String(args.actor_subject_id),
              preview: true,
              applied: false,
            };
          }
          const applied = await applyExtraction(
            applyExtractionSchema.parse({
              workspace_id: args.workspace_id,
              project_id: args.project_id,
              actor_subject_id: args.actor_subject_id,
              sensitivity: args.sensitivity,
              idempotency_prefix:
                args.idempotency_prefix ?? `extract-run-${Date.now()}`,
              candidates: preview.candidates,
            }),
          );
          return {
            ...preview,
            preview: false,
            applied: true,
            apply: applied,
          };
        }
        case 'memory.embed_missing': {
          if (!gateway) {
            return {
              error: 'supabase gateway required for embed persist',
              backend: 'memory-store',
            };
          }
          const subjectId = String(args.actor_subject_id);
          const workspaceId = String(args.workspace_id);
          const limit = Math.min(
            Math.max(Number(args.limit ?? 25) || 25, 1),
            100,
          );
          const rows = await gateway.listMemories({
            subjectId,
            workspaceId,
            status: args.status ? String(args.status) : null,
            limit: 200,
          });
          const missing = rows.filter(
            (row) => !Array.isArray(row.embedding) || row.embedding.length === 0,
          );
          const batch = missing.slice(0, limit);
          const results: Array<{
            memoryId: string;
            dims: number;
            engine: string;
          }> = [];
          const failed: Array<{ memoryId: string; error: string }> = [];
          for (const row of batch) {
            try {
              const full = await gateway.getMemory({
                subjectId,
                memoryId: row.id,
              });
              const vec = await embedMemoryText(full.title, full.content);
              if (vec.vector.length === 0) {
                failed.push({
                  memoryId: row.id,
                  error: 'empty embedding vector',
                });
                continue;
              }
              const saved = await gateway.setMemoryEmbedding({
                subjectId,
                memoryId: row.id,
                embedding: vec.vector,
                engine: vec.engine,
              });
              results.push({
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
          return {
            scanned: rows.length,
            missing: missing.length,
            embedded: results.length,
            failed,
            results,
            backend: 'supabase',
          };
        }
        case 'memory.set_status': {
          const input = setMemoryStatusSchema.parse({
            status: args.status,
            reason: args.reason,
            actor_subject_id: args.actor_subject_id,
          });
          if (gateway) {
            return gateway.setMemoryStatus({
              subjectId: input.actor_subject_id,
              memoryId: String(args.memory_id),
              status: input.status,
              reason: input.reason,
            });
          }
          const updated = store.setMemoryStatus({
            memoryId: String(args.memory_id),
            status: input.status,
            reason: input.reason,
            actorSubjectId: input.actor_subject_id,
          });
          return {
            id: updated.id,
            status: updated.status,
            title: updated.title,
            reason: input.reason,
          };
        }
        case 'capture.document': {
          const input = captureDocumentSchema.parse(args);
          const parsed = await extractTextFromBytes({
            filename: input.filename,
            mimeType: input.mime_type,
            bytes: decodeBase64Document(input.content_base64),
          });
          const text = [
            `Source file: ${parsed.filename} (${parsed.mimeType})`,
            parsed.engine !== 'native' ? `OCR engine: ${parsed.engine}` : null,
            '',
            parsed.text,
          ]
            .filter((line) => line !== null)
            .join('\n');
          if (gateway) {
            const captureResult = await gateway.captureText({
              subjectId: input.actor_subject_id,
              workspaceId: input.workspace_id,
              projectId: input.project_id,
              title: input.title,
              text,
              idempotencyKey: input.idempotency_key,
              sensitivity: input.sensitivity,
              processNow: input.process_now,
              filename: parsed.filename,
              mimeType: parsed.mimeType,
            });
            const embedding = await maybeEmbedMcpCapture(gateway, {
              subjectId: input.actor_subject_id,
              title: input.title,
              text,
              captureResult,
            });
            return {
              ...captureResult,
              extractedChars: parsed.text.length,
              engine: parsed.engine,
              embedding,
            };
          }
          return {
            ...store.captureText({
              workspaceId: input.workspace_id,
              projectId: input.project_id,
              title: input.title,
              text,
              actorSubjectId: input.actor_subject_id,
              idempotencyKey: input.idempotency_key,
              sensitivity: input.sensitivity,
            }),
            extractedChars: parsed.text.length,
            engine: parsed.engine,
          };
        }
        case 'capture.link': {
          const input = captureLinkSchema.parse(args);
          const fetched = await fetchPublicLink(input.url);
          const title = input.title ?? fetched.title;
          const text = [
            `Source URL: ${fetched.finalUrl}`,
            fetched.contentType ? `Content-Type: ${fetched.contentType}` : null,
            '',
            fetched.text,
          ]
            .filter((line) => line !== null)
            .join('\n');
          if (gateway) {
            const captureResult = await gateway.captureText({
              subjectId: input.actor_subject_id,
              workspaceId: input.workspace_id,
              projectId: input.project_id,
              title,
              text,
              idempotencyKey: input.idempotency_key,
              sensitivity: input.sensitivity,
              processNow: input.process_now,
              filename: fetched.finalUrl,
              mimeType: 'text/html',
            });
            const embedding = await maybeEmbedMcpCapture(gateway, {
              subjectId: input.actor_subject_id,
              title,
              text,
              captureResult,
            });
            return { ...captureResult, embedding };
          }
          return store.captureText({
            workspaceId: input.workspace_id,
            projectId: input.project_id,
            title,
            text,
            actorSubjectId: input.actor_subject_id,
            idempotencyKey: input.idempotency_key,
            sensitivity: input.sensitivity,
          });
        }
        default: {
          const _exhaustive: never = name as never;
          throw new Error(`Unknown tool: ${_exhaustive}`);
        }
      }
    },
  };
}
