import { createHmac, timingSafeEqual } from 'node:crypto';
import { githubRepositoryToCollection, type GitHubRepositoryRecord } from '@memory-os/connector-github';
import type { ConnectorCollection } from '@memory-os/connector-sdk';

export const GITHUB_WEBHOOK_CURSOR_STREAM = 'github:webhook';
export const GITHUB_WEBHOOK_EVENT_HEADER = 'x-github-event';
export const GITHUB_WEBHOOK_DELIVERY_HEADER = 'x-github-delivery';
export const GITHUB_WEBHOOK_SIGNATURE_HEADER = 'x-hub-signature-256';

export type GitHubWebhookPayload = {
  action?: string;
  zen?: string;
  hook_id?: number;
  ref?: string;
  after?: string;
  repository?: GitHubRepositoryRecord;
  connection_id?: string;
};

export type GitHubWebhookVerificationResult =
  | { ok: true; mode: 'signed' | 'unsigned_local' }
  | {
      ok: false;
      error: 'signature_required' | 'signature_invalid' | 'secret_missing';
    };

function isLocalOrTestEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const name = (env.MEMORY_OS_ENV ?? '').trim().toLowerCase();
  return name === 'local' || name === 'test';
}

function normalizeSecret(secret: string | null | undefined): string | null {
  const next = secret?.trim();
  return next ? next : null;
}

export function isGitHubWebhookSignatureRequired(
  env: NodeJS.ProcessEnv = process.env,
  secret = env.MEMORY_OS_GITHUB_WEBHOOK_SECRET,
): boolean {
  return normalizeSecret(secret) !== null || !isLocalOrTestEnv(env);
}

export function verifyGitHubWebhookSignature(input: {
  rawBody: string;
  signatureHeader?: string | null;
  secret?: string | null;
  env?: NodeJS.ProcessEnv;
}): GitHubWebhookVerificationResult {
  const env = input.env ?? process.env;
  const secret = normalizeSecret(input.secret ?? env.MEMORY_OS_GITHUB_WEBHOOK_SECRET);
  const provided = input.signatureHeader?.trim() ?? null;

  if (!secret) {
    if (isLocalOrTestEnv(env)) {
      return { ok: true, mode: 'unsigned_local' };
    }
    return { ok: false, error: 'secret_missing' };
  }

  if (!provided) {
    return { ok: false, error: 'signature_required' };
  }

  const expected = `sha256=${createHmac('sha256', secret).update(input.rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return { ok: false, error: 'signature_invalid' };
  }
  return timingSafeEqual(expectedBuffer, providedBuffer)
    ? { ok: true, mode: 'signed' }
    : { ok: false, error: 'signature_invalid' };
}

export function parseGitHubWebhookPayload(rawBody: string): GitHubWebhookPayload {
  return JSON.parse(rawBody) as GitHubWebhookPayload;
}

export function describeGitHubWebhookAction(input: {
  event: string;
  payload: GitHubWebhookPayload;
}): string {
  switch (input.event) {
    case 'repository':
      return input.payload.action ?? 'updated';
    case 'public':
      return 'publicized';
    case 'push':
      return 'pushed';
    case 'ping':
      return 'ping';
    default:
      return input.payload.action ?? input.event;
  }
}

export function resolveGitHubWebhookRepositoryCollection(
  payload: GitHubWebhookPayload,
): ConnectorCollection | null {
  if (!payload.repository) return null;
  if (!(payload.repository.full_name ?? payload.repository.name)) return null;
  return githubRepositoryToCollection(payload.repository);
}
