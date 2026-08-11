import { Hono } from 'hono';
import { authorize, type AuthzContext } from '@memory-os/authz';
import { createSeededStore, type MemoryStore } from '@memory-os/domain';
import {
  createDecisionSchema,
  createHandoffSchema,
  ingestionEnvelopeSchema,
  upsertProjectStateSchema,
} from '@memory-os/schemas';
import { projectContext, searchMemories } from '@memory-os/retrieval';

export type ApiVariables = {
  store: MemoryStore;
  authz: AuthzContext;
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

export function createApp(store: MemoryStore = createSeededStore()) {
  const app = new Hono<{ Variables: ApiVariables }>();

  app.use('*', async (c, next) => {
    const subjectId = c.req.header('x-subject-id') ?? owner;
    c.set('store', store);
    c.set('authz', seedAuthz(subjectId));
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true, service: 'memory-api' }));

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
      !authz.isOwner
    ) {
      // owners + agents with memory write for demo
      if (
        !authorize(authz, {
          resourceType: 'memory',
          action: 'write',
          projectId: body.scope.project_id,
          sensitivity: body.scope.sensitivity,
        })
      ) {
        return c.json({ error: 'forbidden' }, 403);
      }
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

  app.get('/v1/projects/:id/context', (c) => {
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
    const store = c.get('store');
    return c.json(
      projectContext([...store.memories.values()], projectId),
    );
  });

  app.get('/v1/projects/:id/state', (c) => {
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
    const store = c.get('store');
    const allowed = [...store.memories.values()].filter((m) =>
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
