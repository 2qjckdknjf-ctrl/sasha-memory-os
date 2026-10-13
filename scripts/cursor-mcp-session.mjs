#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const CURSOR_SUBJECT_ID = '33333333-3333-4333-8333-333333333303';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CURSOR_BOOTSTRAP_PACK_VERSION = 'm18-s01-v1';
const CANONICAL_PLAN_QUERY =
  'SASHA MEMORY OS — CANONICAL COMPLETION PLAN TO 100% — 2026-08-21';
const CURRENT_CONTEXT_QUERY =
  'current goal canonical decisions current milestone active blockers recent merges unresolved conflicts next work source freshness';
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
if (!['bootstrap', 'search', 'get', 'store-decision'].includes(command)) {
  fail(
    'Usage: cursor-mcp-session.mjs bootstrap|search|get|store-decision --project-id <uuid> ...',
  );
}

function gitOutput(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function inspectGitContext() {
  gitOutput([
    'fetch',
    '--quiet',
    'origin',
    'refs/heads/main:refs/remotes/origin/main',
  ]);
  return {
    headSha: gitOutput(['rev-parse', 'HEAD']),
    branch: gitOutput(['branch', '--show-current']) || '(detached)',
    originMainSha: gitOutput(['rev-parse', 'origin/main']),
    mergeBaseSha: gitOutput(['merge-base', 'HEAD', 'origin/main']),
    workingTree: gitOutput(['status', '--short']) || 'clean',
    recentMain: gitOutput([
      'log',
      '-5',
      '--pretty=format:%H\t%s',
      'origin/main',
    ]).split('\n'),
  };
}

const tsx = resolve(root, 'node_modules/.bin/tsx');
const server = resolve(root, 'apps/mcp-gateway/src/stdio.ts');
const useStdio = Boolean(
  process.env.MEMORY_OS_SUPABASE_SERVICE_ROLE_KEY?.trim(),
);
const child = useStdio
  ? spawn(tsx, [server], {
      cwd: root,
      env: {
        ...process.env,
        MEMORY_OS_MCP_PROFILE: 'full',
        MEMORY_OS_DEFAULT_SUBJECT_ID: CURSOR_SUBJECT_ID,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  : null;

function remoteMcpUrl() {
  const base = process.env.MEMORY_OS_SUPABASE_URL.replace(/\/$/, '');
  if (base.endsWith('/functions/v1/memory-mcp')) return `${base}/mcp`;
  if (base.endsWith('/functions/v1/memory-mcp/mcp')) return base;
  return `${base}/functions/v1/memory-mcp/mcp`;
}

let buffer = Buffer.alloc(0);
let nextId = 1;
const pending = new Map();
let stderr = '';

child?.stderr.on('data', (chunk) => {
  stderr += String(chunk);
});

child?.stdout.on('data', (chunk) => {
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

child?.on('exit', (code) => {
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
  if (!child) {
    return fetch(remoteMcpUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-memory-os-api-secret': process.env.MEMORY_OS_API_SECRET,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          `Cursor remote MCP returned HTTP ${response.status}: ${JSON.stringify(payload)}`,
        );
      }
      return payload;
    });
  }
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

async function callTool(name, args) {
  const response = await rpc('tools/call', { name, arguments: args });
  if (response.error) throw new Error(JSON.stringify(response.error));
  if (response.result?.isError) {
    throw new Error(JSON.stringify(response.result.content ?? response.result));
  }
  return response.result?.structuredContent ?? response.result;
}

function searchArgs(query) {
  return {
    actor_subject_id: CURSOR_SUBJECT_ID,
    workspace_id: WORKSPACE_ID,
    project_id: projectId,
    query,
    pack_context: values['pack-context'] !== 'false',
    max_context_chars: Number(values['max-context-chars'] ?? 6000),
    include_history: values['include-history'] === 'true',
  };
}

function compactSearchResult(value) {
  const result = value && typeof value === 'object' ? value : {};
  const hits = Array.isArray(result.hits) ? result.hits : [];
  return {
    ranking: result.ranking ?? null,
    rankingVersion: result.rankingVersion ?? null,
    context: result.context ?? null,
    hits: hits.slice(0, 8).map((hit) => ({
      id: hit?.memory?.id ?? null,
      title: hit?.memory?.title ?? null,
      status: hit?.memory?.status ?? null,
      recordedAt:
        hit?.memory?.recordedAt ?? hit?.memory?.recorded_at ?? null,
      score: hit?.score ?? null,
    })),
  };
}

function compactProjectContext(value) {
  const result = value && typeof value === 'object' ? value : {};
  const decisions = Array.isArray(result.decisions) ? result.decisions : [];
  return {
    projectId: result.projectId ?? projectId,
    state: result.state ?? null,
    latestHandoff: result.latestHandoff ?? null,
    decisions: decisions.slice(0, 8).map((decision) => ({
      id: decision?.id ?? null,
      title: decision?.title ?? null,
      status: decision?.status ?? null,
      recordedAt: decision?.recordedAt ?? decision?.recorded_at ?? null,
      content: String(decision?.content ?? '').slice(0, 1500),
    })),
  };
}

try {
  const initialized = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'cursor-shared-memory-acceptance', version: '1.0.0' },
  });
  if (initialized.error) throw new Error(JSON.stringify(initialized.error));

  let output;
  if (command === 'bootstrap') {
    const git = inspectGitContext();
    const canonicalPlan = await callTool(
      'memory.search',
      searchArgs(CANONICAL_PLAN_QUERY),
    );
    const currentContext = await callTool(
      'memory.search',
      searchArgs(values.query?.trim() || CURRENT_CONTEXT_QUERY),
    );
    const projectContext = await callTool('context.project', {
      actor_subject_id: CURSOR_SUBJECT_ID,
      project_id: projectId,
    });
    output = {
      packVersion: CURSOR_BOOTSTRAP_PACK_VERSION,
      transport: useStdio ? 'stdio' : 'edge-http',
      projectId,
      actorSubjectId: CURSOR_SUBJECT_ID,
      git,
      canonicalPlan: compactSearchResult(canonicalPlan),
      currentContext: compactSearchResult(currentContext),
      projectContext: compactProjectContext(projectContext),
      nextRequiredStep:
        'Create one bounded execution slice before editing; after merge use store-decision, which performs mandatory read-after-write.',
    };
  } else if (command === 'search') {
    output = await callTool(
      'memory.search',
      searchArgs(required(values, 'query')),
    );
  } else if (command === 'get') {
    output = await callTool('memory.get', {
      actor_subject_id: CURSOR_SUBJECT_ID,
      memory_id: required(values, 'memory-id'),
    });
  } else {
    const title = required(values, 'title');
    const content = required(values, 'content');
    const write = await callTool('memory.store_decision', {
      actor_subject_id: CURSOR_SUBJECT_ID,
      workspace_id: WORKSPACE_ID,
      project_id: projectId,
      title,
      content,
      idempotency_key: required(values, 'idempotency-key'),
    });
    const memoryId = String(write?.id ?? '').trim();
    if (!memoryId) throw new Error('Memory write returned no id');
    const read = await callTool('memory.get', {
      actor_subject_id: CURSOR_SUBJECT_ID,
      memory_id: memoryId,
    });
    const memory = read?.memory ?? read;
    const readProjectId = String(
      memory?.projectId ?? memory?.project_id ?? '',
    ).trim();
    if (
      String(memory?.id ?? '').trim() !== memoryId ||
      readProjectId.toLowerCase() !== projectId.toLowerCase() ||
      String(memory?.title ?? '') !== title ||
      String(memory?.content ?? '') !== content
    ) {
      throw new Error('Memory read-after-write verification failed');
    }
    output = {
      ...write,
      readAfterWrite: {
        verified: true,
        memoryId,
        projectId: readProjectId,
        status: memory?.status ?? null,
        title: memory?.title ?? null,
      },
    };
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  child?.stdin.end();
  child?.kill('SIGTERM');
}
