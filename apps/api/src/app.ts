import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authorize, type AuthzContext } from '@memory-os/authz';
import { createSeededStore, type MemoryStore } from '@memory-os/domain';
import {
  captureTextSchema,
  createDecisionSchema,
  createHandoffSchema,
  ingestionEnvelopeSchema,
  upsertProjectStateSchema,
} from '@memory-os/schemas';
import { projectContext, searchMemories } from '@memory-os/retrieval';
import type { SupabaseMemoryGateway } from './supabase.js';

export type ApiVariables = {
  store: MemoryStore;
  authz: AuthzContext;
  gateway: SupabaseMemoryGateway | null;
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

export function createApp(options?: {
  store?: MemoryStore;
  gateway?: SupabaseMemoryGateway | null;
}) {
  const store = options?.store ?? createSeededStore();
  const gateway = options?.gateway ?? null;
  const app = new Hono<{ Variables: ApiVariables }>();

  app.use(
    '*',
    cors({
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      allowHeaders: ['Content-Type', 'x-subject-id'],
    }),
  );

  app.use('*', async (c, next) => {
    const subjectId = c.req.header('x-subject-id') ?? owner;
    c.set('store', store);
    c.set('gateway', gateway);
    c.set('authz', seedAuthz(subjectId));
    await next();
  });

  app.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'memory-api',
      backend: gateway ? 'supabase' : 'memory-store',
    }),
  );

  app.get('/v1/connections', async (c) => {
    const authz = c.get('authz');
    const workspaceId = c.req.query('workspace_id') ?? seedWorkspace;
    const gw = c.get('gateway');
    if (!gw) {
      return c.json({
        connections: [
          {
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
        return c.json(result, 201);
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
        const hits = await gw.search({
          subjectId: authz.subjectId,
          query: body.query ?? '',
          projectId: body.project_id,
          includeHistory: body.include_history,
        });
        return c.json({ hits });
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
    return c.json({
      hits: searchMemories(allowed, body.query ?? '', {
        projectId: body.project_id,
        includeHistory: body.include_history,
      }),
    });
  });

  return app;
}
