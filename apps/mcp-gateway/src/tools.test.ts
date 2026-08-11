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
        'connections.list',
        'connections.upsert',
        'connections.set_status',
        'capture.text',
        'connections.sync',
        'capture.document',
        'capture.link',
        'memory.set_status',
      ]),
    );
  });

  it('sets memory status offline', async () => {
    const mcp = createMcpHandlers();
    const chatgpt = '33333333-3333-4333-8333-333333333302';
    const captured = (await mcp.call('capture.text', {
      workspace_id: workspaceId,
      project_id: projectId,
      title: 'Review me',
      text: 'Candidate for status change',
      actor_subject_id: chatgpt,
      idempotency_key: 'mcp-status-1',
    })) as { memoryId: string };
    const updated = (await mcp.call('memory.set_status', {
      memory_id: captured.memoryId,
      status: 'verified',
      reason: 'Looks good',
      actor_subject_id: '33333333-3333-4333-8333-333333333301',
    })) as { status: string };
    expect(updated.status).toBe('verified');
  });

  it('captures document offline via base64 text', async () => {
    const mcp = createMcpHandlers();
    const chatgpt = '33333333-3333-4333-8333-333333333302';
    const result = (await mcp.call('capture.document', {
      workspace_id: workspaceId,
      project_id: projectId,
      title: 'MCP doc',
      filename: 'note.txt',
      mime_type: 'text/plain',
      content_base64: Buffer.from('Document via MCP').toString('base64'),
      actor_subject_id: chatgpt,
      idempotency_key: 'mcp-doc-1',
    })) as { memoryId: string; extractedChars?: number };
    expect(result.memoryId).toBeTruthy();
    expect(result.extractedChars).toBeGreaterThan(0);
  });

  it('returns offline stub for connections.sync', async () => {
    const mcp = createMcpHandlers();
    const result = (await mcp.call('connections.sync', {
      workspace_id: workspaceId,
      actor_subject_id: cursor,
    })) as { count: number; backend?: string };
    expect(result.count).toBe(0);
    expect(result.backend).toBe('memory-store');
  });

  it('captures text offline into candidate memory', async () => {
    const mcp = createMcpHandlers();
    const chatgpt = '33333333-3333-4333-8333-333333333302';
    const result = (await mcp.call('capture.text', {
      workspace_id: workspaceId,
      project_id: projectId,
      title: 'MCP capture',
      text: 'Captured via MCP tool',
      actor_subject_id: chatgpt,
      idempotency_key: 'mcp-capture-1',
    })) as { memoryId: string };
    expect(result.memoryId).toBeTruthy();
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
