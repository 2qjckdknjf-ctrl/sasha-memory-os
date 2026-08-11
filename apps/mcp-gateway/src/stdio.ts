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
import { handleMcpJsonRpc, type JsonRpcReq } from './rpc.js';
import { createMcpHandlers } from './tools.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
config({ path: resolve(root, '.env') });

const env = loadMemoryOsEnv();
const gateway = env
  ? new SupabaseMemoryGateway(createMemoryOsClient(env), env.apiSecret)
  : null;
const mcp = createMcpHandlers({ gateway });

function writeMessage(payload: unknown): void {
  const body = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
  process.stdout.write(header + body);
}

async function handle(msg: JsonRpcReq): Promise<void> {
  const res = await handleMcpJsonRpc(mcp, msg);
  if (res !== null) writeMessage(res);
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
