import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const projectId = '44444444-4444-4444-8444-444444444401';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const cursor = '33333333-3333-4333-8333-333333333303';
const chatgpt = '33333333-3333-4333-8333-333333333302';

describe('memory api demo slice', () => {
  it('serves project context to cursor', async () => {
    const app = createApp();
    const res = await app.request(`/v1/projects/${projectId}/context`, {
      headers: { 'x-subject-id': cursor },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decisions.length).toBeGreaterThan(0);
  });

  it('creates handoff from cursor', async () => {
    const app = createApp();
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

  it('idempotently ingests events', async () => {
    const app = createApp();
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
