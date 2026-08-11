import { createMcpHandlers } from './tools.js';

export type McpHandlers = ReturnType<typeof createMcpHandlers>;

export type JsonRpcReq = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export type JsonRpcRes = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

function ok(
  id: string | number | null | undefined,
  result: unknown,
): JsonRpcRes {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function fail(
  id: string | number | null | undefined,
  code: number,
  message: string,
): JsonRpcRes {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  };
}

/** Shared MCP JSON-RPC dispatcher for stdio + HTTP transports. */
export async function handleMcpJsonRpc(
  mcp: McpHandlers,
  msg: JsonRpcReq,
): Promise<JsonRpcRes | null> {
  const method = msg.method ?? '';
  switch (method) {
    case 'initialize':
      return ok(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'memory-os-mcp-gateway',
          version: '0.0.0',
          backend: mcp.backend,
        },
      });
    case 'notifications/initialized':
    case 'initialized':
      return null;
    case 'ping':
      return ok(msg.id, {});
    case 'tools/list':
      return ok(msg.id, {
        tools: mcp.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await mcp.call(name, args);
        return ok(msg.id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        });
      } catch (err) {
        return fail(
          msg.id,
          -32000,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    default:
      return fail(msg.id, -32601, `Method not found: ${method}`);
  }
}
