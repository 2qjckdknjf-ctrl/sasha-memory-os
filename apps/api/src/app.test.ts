import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const projectId = '44444444-4444-4444-8444-444444444401';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const cursor = '33333333-3333-4333-8333-333333333303';
const chatgpt = '33333333-3333-4333-8333-333333333302';

describe('memory api demo slice', () => {
  it('starts oauth stub offline', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const res = await app.request('/v1/oauth/start', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        connector_id: 'github',
        display_name: 'OAuth pilot',
        scopes: ['repositories.read'],
        actor_subject_id: ownerId,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(String(body.authorizeUrl)).toContain('stub://oauth/github');
  });

  it('resolves actor via x-actor-key', async () => {
    const app = createApp({});
    const res = await app.request('/v1/me', {
      headers: { 'x-actor-key': 'cursor' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subjectId).toBe(cursor);
    expect(body.actor.externalKey).toBe('cursor');
  });

  it('upserts connection stub offline', async () => {
    const app = createApp({});
    const owner = '33333333-3333-4333-8333-333333333301';
    const res = await app.request('/v1/connections', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        connector_id: 'gmail',
        display_name: 'Pilot inbox',
        scopes: ['messages.metadata'],
        actor_subject_id: owner,
      }),
    });
    expect(res.status).toBe(201);
  });

  it('serves project context to cursor', async () => {
    const app = createApp({});
    const res = await app.request(`/v1/projects/${projectId}/context`, {
      headers: { 'x-subject-id': cursor },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decisions.length).toBeGreaterThan(0);
  });

  it('creates handoff from cursor', async () => {
    const app = createApp({});
    const res = await app.request('/v1/handoffs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': cursor,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        from_subject_id: cursor,
        to_subject_id: chatgpt,
        idempotency_key: 'handoff-1',
        payload: {
          completed: ['read project context'],
          artifacts: [{ type: 'commit', ref: 'abc123' }],
          validation: ['typecheck'],
          open_items: ['WP-02 apply to remote supabase'],
          blockers: [],
          recommended_next: ['continue MCP wiring'],
        },
      }),
    });
    expect(res.status).toBe(201);
  });

  it('captures a plain-text document into candidate memory', async () => {
    const app = createApp({});
    const content = Buffer.from(
      'Document capture alpha for Memory OS.',
      'utf8',
    ).toString('base64');
    const res = await app.request('/v1/capture/document', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        title: 'Doc capture',
        filename: 'note.txt',
        mime_type: 'text/plain',
        content_base64: content,
        actor_subject_id: chatgpt,
        idempotency_key: 'manual/doc-1',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.memoryId).toBeTruthy();
    expect(body.extractedChars).toBeGreaterThan(10);
  });

  it('rejects oversized document capture', async () => {
    const app = createApp({});
    const content = Buffer.alloc(5 * 1024 * 1024 + 8, 97).toString('base64');
    const res = await app.request('/v1/capture/document', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        title: 'Poison huge',
        filename: 'huge.txt',
        mime_type: 'text/plain',
        content_base64: content,
        actor_subject_id: chatgpt,
        idempotency_key: `poison/huge-${Date.now()}`,
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects private link capture targets', async () => {
    const app = createApp({});
    const res = await app.request('/v1/capture/link', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        url: 'http://127.0.0.1/secret',
        actor_subject_id: chatgpt,
        idempotency_key: 'manual/link-blocked-1',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('captures text into candidate memory', async () => {
    const app = createApp({});
    const res = await app.request('/v1/capture/text', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        title: 'Capture alpha',
        text: 'Text capture creates a reviewable candidate memory.',
        actor_subject_id: chatgpt,
        idempotency_key: 'manual/capture-1',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.memoryId).toBeTruthy();
  });

  it('requires api secret on consolidation when auth enforced', async () => {
    const prevRequire = process.env.MEMORY_OS_REQUIRE_API_AUTH;
    const prevSecret = process.env.MEMORY_OS_API_SECRET;
    process.env.MEMORY_OS_REQUIRE_API_AUTH = '1';
    process.env.MEMORY_OS_API_SECRET = 'test-http-secret';
    try {
      const app = createApp({});
      const ownerId = '33333333-3333-4333-8333-333333333301';
      const denied = await app.request('/v1/consolidation/run', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-subject-id': ownerId,
          'x-actor-key': 'owner',
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          actor_subject_id: ownerId,
          apply: false,
        }),
      });
      expect(denied.status).toBe(401);
      const allowed = await app.request('/v1/consolidation/run', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-subject-id': ownerId,
          'x-actor-key': 'owner',
          'x-memory-os-api-secret': 'test-http-secret',
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          actor_subject_id: ownerId,
          apply: false,
        }),
      });
      expect(allowed.status).toBe(200);
    } finally {
      if (prevRequire === undefined) delete process.env.MEMORY_OS_REQUIRE_API_AUTH;
      else process.env.MEMORY_OS_REQUIRE_API_AUTH = prevRequire;
      if (prevSecret === undefined) delete process.env.MEMORY_OS_API_SECRET;
      else process.env.MEMORY_OS_API_SECRET = prevSecret;
    }
  });

  it('serves health with embed/vault modes', async () => {
    const app = createApp({});
    const mcpHealth = await app.request('/mcp/health');
    expect(mcpHealth.status).toBe(200);
    const mcpInit = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    });
    expect(mcpInit.status).toBe(200);
    const mcpBody = await mcpInit.json();
    expect(mcpBody.result.serverInfo.name).toBe('memory-os-mcp-gateway');

    const res = await app.request('/health', {
      headers: { 'x-request-id': 'test-req-health-1' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('test-req-health-1');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.embedEngine).toBeTruthy();
    expect(body.vaultBackend).toBeTruthy();
    expect(body.mcp).toBe('/mcp');
    expect(body.requestId).toBe('test-req-health-1');
  });

  it('previews extraction candidates', async () => {
    const app = createApp({});
    const res = await app.request('/v1/extraction/preview', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-key': 'chatgpt',
      },
      body: JSON.stringify({
        title: 'Pilot',
        text: 'We keep Memory OS in eu-central-1.',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preview).toBe(true);
    expect(body.candidates.length).toBeGreaterThan(0);
    expect(String(body.engine)).toMatch(/extraction/);
  });

  it('applies extraction candidates into memories', async () => {
    const app = createApp({});
    const res = await app.request('/v1/extraction/apply', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-key': 'chatgpt',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        actor_subject_id: chatgpt,
        idempotency_prefix: `extract-apply-${Date.now()}`,
        candidates: [
          {
            title: 'Region fact',
            content: 'Primary region is eu-central-1',
            memoryType: 'fact',
            confidence: 0.8,
          },
          {
            title: 'Ship decision',
            content: 'Accept RG0 and continue M4 extraction path',
            memoryType: 'decision',
            confidence: 0.9,
          },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.applied).toBe(2);
    expect(body.failed).toBe(0);
    expect(body.items).toHaveLength(2);
  });

  it('filters memories by recorded_at window', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    await app.request('/v1/memories', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        memory_type: 'fact',
        title: 'Temporal window note',
        content: 'inside recorded_after filter',
        actor_subject_id: ownerId,
        idempotency_key: `temporal-${Date.now()}`,
      }),
    });
    const farFuture = '2099-01-01T00:00:00.000Z';
    const empty = await app.request(
      `/v1/memories?recorded_after=${encodeURIComponent(farFuture)}`,
      { headers: { 'x-subject-id': ownerId } },
    );
    expect(empty.status).toBe(200);
    const emptyBody = await empty.json();
    expect(emptyBody.memories).toEqual([]);

    const past = '2000-01-01T00:00:00.000Z';
    const listed = await app.request(
      `/v1/memories?recorded_after=${encodeURIComponent(past)}&limit=100`,
      { headers: { 'x-subject-id': ownerId } },
    );
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(
      body.memories.some(
        (m: { title?: string }) => m.title === 'Temporal window note',
      ),
    ).toBe(true);
  });

  it('exports full memories for owner', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    await app.request('/v1/memories', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        memory_type: 'fact',
        title: 'Export full',
        content: 'y'.repeat(600),
        actor_subject_id: ownerId,
        idempotency_key: `export-full-${Date.now()}`,
      }),
    });
    const denied = await app.request('/v1/export/memories', {
      headers: { 'x-actor-key': 'chatgpt' },
    });
    expect(denied.status).toBe(403);
    const res = await app.request('/v1/export/memories?limit=50', {
      headers: { 'x-subject-id': ownerId, 'x-actor-key': 'owner' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.format).toBe('memory-os.export.memories.v1');
    expect(body.count).toBeGreaterThan(0);
    const hit = body.memories.find(
      (m: { title?: string }) => m.title === 'Export full',
    );
    expect(hit?.content?.length).toBe(600);
  });

  it('gets memory offline with full content', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const created = await app.request('/v1/memories', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        memory_type: 'fact',
        title: 'Full get',
        content: 'x'.repeat(600),
        actor_subject_id: ownerId,
        idempotency_key: `get-full-${Date.now()}`,
      }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string };
    expect(body.id).toBeTruthy();
    const res = await app.request(`/v1/memories/${body.id}`, {
      headers: {
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
    });
    expect(res.status).toBe(200);
    const got = (await res.json()) as { memory: { content: string } };
    expect(got.memory.content.length).toBe(600);
  });

  it('embeds offline rejection without supabase gateway', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const res = await app.request(
      '/v1/memories/11111111-1111-4111-8111-111111111199/embed',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-subject-id': ownerId,
          'x-actor-key': 'owner',
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          actor_subject_id: ownerId,
          title: 't',
          text: 'body',
        }),
      },
    );
    expect(res.status).toBe(501);
  });

  it('embed-missing offline rejection without supabase gateway', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const res = await app.request('/v1/memories/embed-missing', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        actor_subject_id: ownerId,
        limit: 5,
      }),
    });
    expect(res.status).toBe(501);
  });

  it('returns empty outbox offline for owner', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const res = await app.request(
      `/v1/outbox/pending?workspace_id=${workspaceId}`,
      {
        headers: {
          'x-subject-id': ownerId,
          'x-actor-key': 'owner',
        },
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.backend).toBe('memory-store');
  });

  it('runs offline consolidation for duplicate candidates', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const common = {
      workspace_id: workspaceId,
      project_id: projectId,
      actor_subject_id: chatgpt,
      title: 'Offline consolidation twin',
      text: 'duplicate candidate for consolidation harness',
    };
    await app.request('/v1/capture/text', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        ...common,
        idempotency_key: `consol/offline-a-${Date.now()}`,
      }),
    });
    await app.request('/v1/capture/text', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        ...common,
        title: 'offline consolidation twin',
        idempotency_key: `consol/offline-b-${Date.now()}`,
      }),
    });
    const res = await app.request('/v1/consolidation/run', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        actor_subject_id: ownerId,
        apply: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backend).toBe('memory-store');
    expect(body.planned).toBeGreaterThanOrEqual(1);
    expect(body.applied.length).toBeGreaterThanOrEqual(1);
  });

  it('idempotently ingests events', async () => {
    const app = createApp({});
    const payload = {
      schema_version: '1.0',
      workspace_id: workspaceId,
      source: { provider: 'manual' },
      event_type: 'note.created',
      observed_at: '2026-08-11T08:00:00.000Z',
      idempotency_key: 'manual/note-1',
      content: { text: 'hello' },
      scope: {
        project_id: projectId,
        sensitivity: 'internal',
        storage_mode: 'indexed',
      },
    };
    const a = await app.request('/v1/ingestion/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify(payload),
    });
    const b = await app.request('/v1/ingestion/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify(payload),
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((await a.json()).id).toBe((await b.json()).id);
  });
});
