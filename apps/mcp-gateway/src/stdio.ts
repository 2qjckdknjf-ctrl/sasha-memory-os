/**
 * Minimal MCP stdio JSON-RPC server (Content-Length framing).
 * Wires createMcpHandlers to stdin/stdout for Cursor / Claude Desktop.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMemoryOsClient,
  loadMemoryOsEnv,
  SupabaseMemoryGateway,
} from '@memory-os/db';
import { createMcpHandlers } from './tools.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
config({ path: resolve(root, '.env') });

const env = loadMemoryOsEnv();
const gateway = env
  ? new SupabaseMemoryGateway(createMemoryOsClient(env), env.apiSecret)
  : null;
const mcp = createMcpHandlers({ gateway });

type JsonRpcReq = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

function writeMessage(payload: unknown): void {
  const body = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
  process.stdout.write(header + body);
}

function respond(id: string | number | null | undefined, result: unknown): void {
  writeMessage({ jsonrpc: '2.0', id: id ?? null, result });
}

function respondError(
  id: string | number | null | undefined,
  code: number,
  message: string,
): void {
  writeMessage({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  });
}

async function handle(msg: JsonRpcReq): Promise<void> {
  const method = msg.method ?? '';
  switch (method) {
    case 'initialize':
      respond(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'memory-os-mcp-gateway',
          version: '0.0.0',
          backend: mcp.backend,
        },
      });
      return;
    case 'notifications/initialized':
    case 'initialized':
      return;
    case 'ping':
      respond(msg.id, {});
      return;
    case 'tools/list':
      respond(msg.id, {
        tools: mcp.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
      return;
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await mcp.call(name, args);
        respond(msg.id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        });
      } catch (err) {
        respondError(
          msg.id,
          -32000,
          err instanceof Error ? err.message : String(err),
        );
      }
      return;
    }
    default:
      respondError(msg.id, -32601, `Method not found: ${method}`);
  }
}

let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) break;
    const header = buffer.subarray(0, headerEnd).toString('utf8');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) break;
    const body = buffer.subarray(start, start + length).toString('utf8');
    buffer = buffer.subarray(start + length);
    let msg: JsonRpcReq;
    try {
      msg = JSON.parse(body) as JsonRpcReq;
    } catch {
      continue;
    }
    void handle(msg);
  }
});

process.stdin.on('end', () => process.exit(0));
process.stderr.write(
  `memory-os mcp-gateway stdio backend=${mcp.backend}\n`,
);
