import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  authorize,
  resolveLocalSubject,
  type AuthzContext,
} from '@memory-os/authz';
import { createSeededStore, type MemoryStore } from '@memory-os/domain';
import { pullGithubDelta } from '@memory-os/connector-github';
import { pullGmailDelta } from '@memory-os/connector-gmail';
import { pullGoogleCalendarDelta } from '@memory-os/connector-google-calendar';
import { pullGoogleDriveDelta } from '@memory-os/connector-google-drive';
import {
  exchangeAuthorizationCode,
  fingerprintAuthorizationCode,
  resolveAuthorizeBase,
  resolveConnectorSyncOutcome,
} from '@memory-os/connector-sdk';
import {
  bindAuthUserSchema,
  captureDocumentSchema,
  captureLinkSchema,
  captureTextSchema,
  createDecisionSchema,
  createHandoffSchema,
  ingestionEnvelopeSchema,
  oauthCompleteSchema,
  oauthStartSchema,
  setConnectionStatusSchema,
  setMemoryStatusSchema,
  upsertConnectionSchema,
  upsertProjectStateSchema,
} from '@memory-os/schemas';
import {
  decodeBase64Document,
  extractTextFromBytes,
  fetchPublicLink,
} from '@memory-os/ingestion';
import {
  createEmbeddingAdapter,
  embedMemoryText,
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
import { requireHttpApiSecret } from './httpAuth.js';

export type ApiVariables = {
  store: MemoryStore;
  authz: AuthzContext;
  gateway: SupabaseMemoryGateway | null;
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
        actions: ['read'],
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
    ],
  };
}

function isForbiddenError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /forbidden|42501|unauthorized/i.test(message);
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

async function pullConnectorDelta(
  item: {
    connectorId: string;
    connectionId: string;
    displayName?: string;
    vaultRef?: string | null;
  },
  vault: ReturnType<typeof createConfiguredVaultStore>,
) {
  const common = {
    connectionId: item.connectionId,
    displayName: item.displayName ?? item.connectorId,
    vaultRef: item.vaultRef ?? undefined,
    vault,
  };
  switch (item.connectorId) {
    case 'github':
      return pullGithubDelta(common);
    case 'google-drive':
      return pullGoogleDriveDelta(common);
    case 'gmail':
      return pullGmailDelta(common);
    case 'google-calendar':
      return pullGoogleCalendarDelta(common);
    default:
      return null;
  }
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
}) {
  const store = options?.store ?? createSeededStore();
  const gateway = options?.gateway ?? null;
  const mcp = createMcpHandlers({ store, gateway });
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
        'Authorization',
      ],
    }),
  );

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
    }),
  );

  // Remote MCP JSON-RPC (ChatGPT mode A when host reachable). Auth outside local/test.
  app.use('/mcp', requireHttpApiSecret);
  app.get('/mcp/health', (c) =>
    c.json({
      ok: true,
      service: 'memory-os-mcp',
      backend: mcp.backend,
    }),
  );
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
  app.use('/v1/jobs/dead-letter-stale', requireHttpApiSecret);
  app.use('/v1/outbox/*', requireHttpApiSecret);
  app.use('/v1/memories/embed-missing', requireHttpApiSecret);

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
        const vault = createConfiguredVaultStore({ gateway: gw });
        for (const item of result.enqueued ?? []) {
          if (!item.jobId) continue;
          try {
            const delta = await pullConnectorDelta(item, vault);
            if (delta) {
              for (const event of delta.items) {
                const captureResult = await gw.captureText({
                  subjectId: actorSubjectId,
                  workspaceId,
                  projectId: seedProject,
                  title: event.title,
                  text: event.text,
                  idempotencyKey: `connector-sync/${item.connectionId}/${event.externalId}`,
                  processNow: true,
                  filename: `${item.connectorId}://${event.externalId}`,
                  mimeType: 'text/plain',
                });
                await maybeEmbedCapturedMemory(gw, {
                  subjectId: actorSubjectId,
                  title: event.title,
                  text: event.text,
                  captureResult,
                });
                captured += 1;
              }
            }
            const pullMode =
              delta && 'mode' in delta && typeof delta.mode === 'string'
                ? delta.mode
                : 'none';
            const note =
              delta && 'note' in delta && typeof delta.note === 'string'
                ? delta.note
                : delta
                  ? undefined
                  : 'unsupported connector';
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
      return c.json({ ...result, completed, captured }, 202);
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

  app.get('/v1/rls/probe', async (c) => {
    const projectId = c.req.query('project_id') ?? seedProject;
    const sensitivity = c.req.query('sensitivity') ?? 'internal';
    const authz = c.get('authz');
    const gw = c.get('gateway');
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
    });
  });

  app.post('/v1/memories', async (c) => {
    const body = createDecisionSchema.parse(await c.req.json());
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

  app.post('/v1/handoffs', async (c) => {
    const body = createHandoffSchema.parse(await c.req.json());
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

  app.post('/v1/search', async (c) => {
    const body = await c.req.json<{
      query: string;
      project_id?: string;
      include_history?: boolean;
    }>();
    const authz = c.get('authz');
    const gw = c.get('gateway');
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
        });
        const list = (Array.isArray(raw) ? raw : []) as Array<{
          memory: {
            title?: string | null;
            content?: string | null;
            embedding?: number[] | null;
          };
          score: number;
          reason?: string;
        }>;
        const hits = await rerankHitsHybrid(list, body.query ?? '', {
          reason: 'hybrid:rpc+embed',
        });
        return c.json({
          hits,
          backend: 'supabase',
          ranking: 'hybrid',
          queryEmbeddingDims: queryEmbedding?.length ?? 0,
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
    });
    return c.json({ hits });
  });

  return app;
}
