/**
 * HTTP JSON-RPC MCP transport (ChatGPT / remote hosts).
 * Auth: same as API — x-memory-os-api-secret / Bearer outside local/test.
 */
import { config } from 'dotenv';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
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
const mcp = createMcpHandlers({
  gateway,
  profile: process.env.MEMORY_OS_MCP_PROFILE,
});

const port = Number(process.env.MEMORY_OS_MCP_HTTP_PORT ?? '8790');

function isAuthRequired(): boolean {
  const flag = (process.env.MEMORY_OS_REQUIRE_API_AUTH ?? '').trim().toLowerCase();
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  const name = (process.env.MEMORY_OS_ENV ?? 'local').trim().toLowerCase();
  return name !== 'local' && name !== 'test';
}

function extractSecret(req: IncomingMessage): string | null {
  const header = req.headers['x-memory-os-api-secret'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    return token || null;
  }
  return null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/mcp/health')) {
    sendJson(res, 200, {
      ok: true,
      service: 'memory-os-mcp-http',
      backend: mcp.backend,
      profile: mcp.profile,
      transport: 'streamable-http',
    });
    return;
  }

  // Streamable HTTP: GET on MCP endpoint may open SSE; this gateway is
  // stateless JSON-only, so advertise POST-only (405) per MCP transport rules.
  if (
    req.method === 'GET' &&
    (url.pathname === '/mcp' || url.pathname === '/')
  ) {
    res.writeHead(405, {
      allow: 'POST',
      'content-type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify({ error: 'method_not_allowed', allow: ['POST'] }));
    return;
  }

  if (req.method !== 'POST' || (url.pathname !== '/mcp' && url.pathname !== '/')) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  if (isAuthRequired()) {
    const expected = process.env.MEMORY_OS_API_SECRET?.trim();
    const provided = extractSecret(req);
    if (!expected || provided !== expected) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
  }

  let msg: JsonRpcReq;
  try {
    msg = JSON.parse(await readBody(req)) as JsonRpcReq;
  } catch {
    sendJson(res, 400, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
    return;
  }

  const result = await handleMcpJsonRpc(mcp, msg);
  if (result === null) {
    res.writeHead(204);
    res.end();
    return;
  }
  sendJson(res, 200, result);
});

server.listen(port, () => {
  process.stderr.write(
    `memory-os mcp-http :${port} backend=${mcp.backend} profile=${mcp.profile} POST /mcp\n`,
  );
});
