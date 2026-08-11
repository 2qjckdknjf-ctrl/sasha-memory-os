import { describe, expect, it } from 'vitest';
import { createMcpHandlers } from './tools.js';

const projectId = '44444444-4444-4444-8444-444444444401';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const cursor = '33333333-3333-4333-8333-333333333303';

describe('mcp gateway alpha', () => {
  it('lists core tools', () => {
    const mcp = createMcpHandlers();
    expect(mcp.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'memory.search',
        'context.project',
        'memory.store_decision',
        'handoff.create',
      ]),
    );
  });

  it('returns project context with seeded decision', async () => {
    const mcp = createMcpHandlers();
    const result = (await mcp.call('context.project', {
      project_id: projectId,
      actor_subject_id: cursor,
    })) as { decisions: unknown[]; state: { version: number } | null };
    expect(result.decisions.length).toBe(1);
    expect(result.state?.version).toBe(1);
  });

  it('lists connections stub offline', async () => {
    const mcp = createMcpHandlers();
    const result = (await mcp.call('connections.list', {
      workspace_id: workspaceId,
      actor_subject_id: cursor,
    })) as { connections: unknown[] };
    expect(result.connections.length).toBeGreaterThan(0);
  });


  it('creates handoff tool result', async () => {
    const mcp = createMcpHandlers();
    const handoff = await mcp.call('handoff.create', {
      workspace_id: workspaceId,
      project_id: projectId,
      from_subject_id: cursor,
      idempotency_key: 'mcp-handoff-1',
      payload: {
        completed: ['context loaded'],
        artifacts: [],
        validation: [],
        open_items: [],
        blockers: [],
        recommended_next: ['ship WP-02'],
      },
    });
    expect((handoff as { projectId: string }).projectId).toBe(projectId);
  });
});
