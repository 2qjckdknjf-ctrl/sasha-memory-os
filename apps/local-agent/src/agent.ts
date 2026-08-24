#!/usr/bin/env node
/**
 * Minimal macOS-oriented local desktop agent for Cursor → Memory OS writes.
 * Secrets: MEMORY_OS_API_SECRET via env or macOS Keychain (security find-generic-password).
 * Durable offline queue with idempotency preservation.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  CANONICAL_WORKSPACE_ID,
  CURSOR_SUBJECT_ID,
  SASHA_MEMORY_OS_PROJECT_ID,
} from '@memory-os/schemas';

export type QueueItem = {
  idempotencyKey: string;
  title: string;
  text: string;
  attempts: number;
  nextAttemptAt: string;
  quarantined?: boolean;
};

export type AgentConfig = {
  apiBase: string;
  workspaceId: string;
  projectId: string;
  actorSubjectId: string;
  queueDir: string;
  dryRun: boolean;
  maxAttempts: number;
};

const DEFAULT_QUEUE = join(homedir(), '.memory-os', 'local-agent-queue');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return {
    apiBase: (env.MEMORY_OS_API_BASE_URL ?? 'http://localhost:8787').replace(/\/$/, ''),
    workspaceId: env.MEMORY_OS_WORKSPACE_ID ?? CANONICAL_WORKSPACE_ID,
    projectId: env.MEMORY_OS_PROJECT_ID ?? SASHA_MEMORY_OS_PROJECT_ID,
    actorSubjectId: env.MEMORY_OS_ACTOR_SUBJECT_ID ?? CURSOR_SUBJECT_ID,
    queueDir: env.MEMORY_OS_LOCAL_QUEUE_DIR ?? DEFAULT_QUEUE,
    dryRun: env.MEMORY_OS_LOCAL_DRY_RUN === '1',
    maxAttempts: Number(env.MEMORY_OS_LOCAL_MAX_ATTEMPTS ?? 5),
  };
}

export function readApiSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const direct = env.MEMORY_OS_API_SECRET?.trim();
  if (direct) return direct;
  const service = env.MEMORY_OS_KEYCHAIN_SERVICE ?? 'sasha-memory-os-api-secret';
  try {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function queuePath(config: AgentConfig): string {
  return join(config.queueDir, 'pending.jsonl');
}

export function readQueue(config: AgentConfig): QueueItem[] {
  const path = queuePath(config);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as QueueItem);
}

export function writeQueue(config: AgentConfig, items: QueueItem[]): void {
  mkdirSync(config.queueDir, { recursive: true });
  const path = queuePath(config);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : ''), 'utf8');
  renameSync(tmp, path);
}

export async function postCapture(
  config: AgentConfig,
  secret: string,
  item: QueueItem,
): Promise<{ ok: boolean; status: number }> {
  if (config.dryRun) return { ok: true, status: 201 };
  const res = await fetch(`${config.apiBase}/v1/capture/text`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-memory-os-api-secret': secret,
      'x-subject-id': config.actorSubjectId,
    },
    body: JSON.stringify({
      workspace_id: config.workspaceId,
      project_id: config.projectId,
      title: item.title,
      text: item.text,
      actor_subject_id: config.actorSubjectId,
      idempotency_key: item.idempotencyKey,
    }),
  });
  return { ok: res.ok, status: res.status };
}

export function enqueue(config: AgentConfig, input: { title: string; text: string; idempotencyKey: string }): void {
  const items = readQueue(config);
  if (items.some((i) => i.idempotencyKey === input.idempotencyKey)) return;
  items.push({
    idempotencyKey: input.idempotencyKey,
    title: input.title,
    text: input.text,
    attempts: 0,
    nextAttemptAt: new Date().toISOString(),
  });
  writeQueue(config, items);
}

export async function drainQueue(config: AgentConfig, secret: string): Promise<{ sent: number; quarantined: number }> {
  const items = readQueue(config);
  const remaining: QueueItem[] = [];
  let sent = 0;
  let quarantined = 0;
  const now = Date.now();

  for (const item of items) {
    if (item.quarantined) {
      remaining.push(item);
      quarantined += 1;
      continue;
    }
    if (new Date(item.nextAttemptAt).getTime() > now) {
      remaining.push(item);
      continue;
    }
    const result = await postCapture(config, secret, item);
    if (result.ok) {
      sent += 1;
      continue;
    }
    const attempts = item.attempts + 1;
    if (attempts >= config.maxAttempts) {
      remaining.push({ ...item, attempts, quarantined: true });
      quarantined += 1;
    } else {
      const backoffMs = Math.min(60_000, 1000 * 2 ** attempts);
      remaining.push({
        ...item,
        attempts,
        nextAttemptAt: new Date(now + backoffMs).toISOString(),
      });
    }
  }
  writeQueue(config, remaining);
  return { sent, quarantined };
}

export function status(config: AgentConfig): Record<string, unknown> {
  const items = readQueue(config);
  return {
    ok: true,
    queueDir: config.queueDir,
    pending: items.filter((i) => !i.quarantined).length,
    quarantined: items.filter((i) => i.quarantined).length,
    projectId: config.projectId,
    actorSubjectId: config.actorSubjectId,
    dryRun: config.dryRun,
  };
}
