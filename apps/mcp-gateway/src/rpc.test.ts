import { describe, expect, it } from 'vitest';
import { handleMcpJsonRpc } from './rpc.js';
import { createMcpHandlers } from './tools.js';

describe('handleMcpJsonRpc', () => {
  it('initializes and lists tools', async () => {
    const mcp = createMcpHandlers();
    const init = await handleMcpJsonRpc(mcp, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    });
    expect(init?.result).toMatchObject({
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'memory-os-mcp-gateway' },
    });

    const listed = await handleMcpJsonRpc(mcp, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    const tools = (listed?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['memory.search', 'capture.text']),
    );
  });

  it('calls capture.text offline', async () => {
    const mcp = createMcpHandlers();
    const res = await handleMcpJsonRpc(mcp, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'capture.text',
        arguments: {
          workspace_id: '11111111-1111-4111-8111-111111111111',
          project_id: '44444444-4444-4444-8444-444444444401',
          title: 'HTTP MCP note',
          text: 'reachable host path for ChatGPT mode A/B',
          actor_subject_id: '33333333-3333-4333-8333-333333333302',
          idempotency_key: 'mcp-http/rpc-test',
          process_now: true,
        },
      },
    });
    expect(res?.error).toBeUndefined();
    expect(res?.result).toBeTruthy();
  });
});
