import { describe, expect, it } from 'vitest';
import {
  CHATGPT_PILOT_TOOLS,
  applyProfileDefaults,
  getMcpProfile,
  isToolAllowed,
  resolveMcpProfileName,
} from './profile.js';
import { createMcpHandlers } from './tools.js';
import { handleMcpJsonRpc } from './rpc.js';

describe('mcp profile', () => {
  it('resolves chatgpt aliases', () => {
    expect(resolveMcpProfileName('chatgpt')).toBe('chatgpt');
    expect(resolveMcpProfileName('a')).toBe('chatgpt');
    expect(resolveMcpProfileName('full')).toBe('full');
  });

  it('limits chatgpt pilot tools and blocks owner ops', async () => {
    const mcp = createMcpHandlers({ profile: 'chatgpt' });
    expect(mcp.profile).toBe('chatgpt');
    expect([...mcp.tools.map((t) => t.name)].sort()).toEqual([...CHATGPT_PILOT_TOOLS].sort());

    await expect(
      mcp.call('oauth.start', {
        workspace_id: '11111111-1111-4111-8111-111111111111',
        connector_id: 'github',
        actor_subject_id: '33333333-3333-4333-8333-333333333301',
      }),
    ).rejects.toThrow(/not available/i);
  });

  it('fills ChatGPT defaults for search', async () => {
    const mcp = createMcpHandlers({ profile: 'chatgpt' });
    const result = (await mcp.call('memory.search', {
      query: 'Slice 01',
      pack_context: true,
    })) as { hits: unknown[]; ranking: string };
    expect(result.ranking).toBe('hybrid-rrf');
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it('initialize advertises instructions + annotations', async () => {
    const mcp = createMcpHandlers({ profile: 'chatgpt' });
    const init = await handleMcpJsonRpc(mcp, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    });
    expect(init?.result).toMatchObject({
      protocolVersion: '2025-03-26',
      instructions: expect.stringContaining('ChatGPT pilot'),
    });

    const listed = await handleMcpJsonRpc(mcp, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    const tools = (
      listed?.result as {
        tools: Array<{
          name: string;
          annotations?: { readOnlyHint?: boolean };
          inputSchema?: { required?: string[] };
        }>;
      }
    ).tools;
    const search = tools.find((t) => t.name === 'memory.search');
    expect(search?.annotations?.readOnlyHint).toBe(true);
    expect(search?.inputSchema?.required ?? []).not.toContain(
      'actor_subject_id',
    );
    expect(search?.inputSchema?.required ?? []).not.toContain('workspace_id');
    expect(search?.inputSchema?.required ?? []).not.toContain('project_id');
    const contextProject = tools.find((t) => t.name === 'context.project');
    expect(contextProject?.inputSchema?.required ?? []).toContain('project_id');
    const capture = tools.find((t) => t.name === 'capture.text');
    expect(capture?.annotations?.readOnlyHint).toBe(false);
    expect(capture?.inputSchema?.required ?? []).toContain('project_id');
    expect(capture?.inputSchema?.required ?? []).not.toContain('actor_subject_id');
    expect(capture?.inputSchema?.required ?? []).not.toContain('workspace_id');
    const storeDecision = tools.find((t) => t.name === 'memory.store_decision');
    expect(storeDecision?.inputSchema?.required ?? []).toContain('project_id');
    expect(storeDecision?.inputSchema?.required ?? []).not.toContain('actor_subject_id');
    expect(storeDecision?.inputSchema?.required ?? []).not.toContain('workspace_id');
    const handoff = tools.find((t) => t.name === 'handoff.create');
    expect(handoff?.inputSchema?.required ?? []).toContain('project_id');
  });

  it('applies defaults helper', () => {
    const profile = getMcpProfile('chatgpt');
    expect(isToolAllowed(profile, 'memory.search')).toBe(true);
    expect(isToolAllowed(profile, 'oauth.start')).toBe(false);
    const filled = applyProfileDefaults(profile, { query: 'x' }, 'memory.search');
    expect(filled.actor_subject_id).toBeTruthy();
    expect(filled.workspace_id).toBeTruthy();
    expect(filled.project_id).toBeUndefined();
    const context = applyProfileDefaults(profile, {}, 'context.project');
    expect(context.project_id).toBeUndefined();
  });
});
