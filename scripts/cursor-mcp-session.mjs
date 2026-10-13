#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const CURSOR_SUBJECT_ID = '33333333-3333-4333-8333-333333333303';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = process.env.MEMORY_OS_ENV_FILE || resolve(root, '.env');

if (existsSync(envPath)) config({ path: envPath, quiet: true });

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      fail(`Invalid argument near ${key ?? '<end>'}`);
    }
    values[key.slice(2)] = value;
  }
  return { command, values };
}

function required(values, key) {
  const value = values[key]?.trim();
  if (!value) fail(`Missing --${key}`);
  return value;
}

if (!process.env.MEMORY_OS_SUPABASE_URL || !process.env.MEMORY_OS_API_SECRET) {
  fail(
    'Live Cursor MCP session requires MEMORY_OS_SUPABASE_URL and MEMORY_OS_API_SECRET. ' +
      'Set MEMORY_OS_ENV_FILE to a private env file when running outside the canonical checkout.',
  );
}

const { command, values } = parseArgs(process.argv.slice(2));
const projectId = required(values, 'project-id');
let toolName;
let toolArgs;

if (command === 'search') {
  toolName = 'memory.search';
  toolArgs = {
    actor_subject_id: CURSOR_SUBJECT_ID,
    workspace_id: WORKSPACE_ID,
    project_id: projectId,
    query: required(values, 'query'),
    pack_context: values['pack-context'] !== 'false',
    include_history: true,
  };
} else if (command === 'store-decision') {
  toolName = 'memory.store_decision';
  toolArgs = {
    actor_subject_id: CURSOR_SUBJECT_ID,
    workspace_id: WORKSPACE_ID,
    project_id: projectId,
    title: required(values, 'title'),
    content: required(values, 'content'),
    idempotency_key: required(values, 'idempotency-key'),
  };
} else {
  fail(
    'Usage: cursor-mcp-session.mjs search|store-decision --project-id <uuid> ...',
  );
}

const tsx = resolve(root, 'node_modules/.bin/tsx');
const server = resolve(root, 'apps/mcp-gateway/src/stdio.ts');
const child = spawn(tsx, [server], {
  cwd: root,
  env: {
    ...process.env,
    MEMORY_OS_MCP_PROFILE: 'full',
    MEMORY_OS_DEFAULT_SUBJECT_ID: CURSOR_SUBJECT_ID,
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buffer = Buffer.alloc(0);
let nextId = 1;
const pending = new Map();
let stderr = '';

child.stderr.on('data', (chunk) => {
  stderr += String(chunk);
});

child.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString('utf8');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) fail('Cursor MCP returned an invalid frame header');
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const message = JSON.parse(
      buffer.subarray(start, start + length).toString('utf8'),
    );
    buffer = buffer.subarray(start + length);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter.resolve(message);
    }
  }
});

child.on('exit', (code) => {
  for (const waiter of pending.values()) {
    waiter.reject(
      new Error(`Cursor MCP exited with code ${code}: ${stderr.trim()}`),
    );
  }
  pending.clear();
});

function rpc(method, params = {}) {
  const id = nextId++;
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Cursor MCP ${method} timed out`));
    }, 30_000);
    pending.set(id, {
      resolve(value) {
        clearTimeout(timer);
        resolvePromise(value);
      },
      reject(error) {
        clearTimeout(timer);
        reject(error);
      },
    });
    child.stdin.write(
      `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`,
    );
  });
}

try {
  const initialized = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'cursor-shared-memory-acceptance', version: '1.0.0' },
  });
  if (initialized.error) throw new Error(JSON.stringify(initialized.error));

  const response = await rpc('tools/call', {
    name: toolName,
    arguments: toolArgs,
  });
  if (response.error) throw new Error(JSON.stringify(response.error));
  if (response.result?.isError) {
    throw new Error(JSON.stringify(response.result.content ?? response.result));
  }
  process.stdout.write(
    `${JSON.stringify(response.result?.structuredContent ?? response.result, null, 2)}\n`,
  );
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
}
