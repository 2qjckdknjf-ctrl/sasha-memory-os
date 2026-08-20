import { randomUUID } from 'node:crypto';
import type { Context, Next } from 'hono';
import {
  createLogger,
  recordHandledAvailability,
  recordSloObservation,
} from '@memory-os/observability';

const log = createLogger('memory-api');

function shouldLogHttp(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.MEMORY_OS_HTTP_LOG ?? '').trim().toLowerCase();
  if (flag === '0' || flag === 'false') return false;
  if (flag === '1' || flag === 'true') return true;
  const name = (env.MEMORY_OS_ENV ?? 'local').trim().toLowerCase();
  return name === 'staging' || name === 'production' || name === 'prod';
}

function isProjectStatePath(path: string): boolean {
  return /^\/v1\/projects\/[^/]+\/state$/.test(path);
}

function isWriteReceiptPath(method: string, path: string): boolean {
  return (
    (method === 'PATCH' && isProjectStatePath(path)) ||
    (method === 'POST' &&
      (path === '/v1/memories' ||
        path === '/v1/handoffs' ||
        path === '/v1/capture/text' ||
        path === '/v1/capture/document' ||
        path === '/v1/capture/link'))
  );
}

/** Attach/propagate x-request-id for staging logs and client correlation. */
export async function withRequestId(
  c: Context,
  next: Next,
): Promise<void> {
  const incoming = c.req.header('x-request-id')?.trim();
  const requestId =
    incoming && incoming.length <= 128 ? incoming : randomUUID();
  c.set('requestId', requestId);
  c.header('x-request-id', requestId);
  const started = Date.now();
  await next();
  const durationMs = Date.now() - started;
  if (c.req.path.startsWith('/v1/')) {
    recordHandledAvailability({
      targetId: 'api.availability',
      statusCode: c.res.status,
      durationMs,
    });
  }
  if (isProjectStatePath(c.req.path) && c.req.method === 'GET') {
    recordSloObservation({
      targetId: 'project.state',
      durationMs,
      outcome: c.res.status >= 500 ? 'error' : 'ok',
    });
  }
  if (isWriteReceiptPath(c.req.method, c.req.path)) {
    recordSloObservation({
      targetId: 'write.receipt',
      durationMs,
      outcome: c.res.status >= 500 ? 'error' : 'ok',
    });
  }
  if (c.req.path.startsWith('/v1/webhooks/')) {
    recordSloObservation({
      targetId: 'webhook.ack',
      durationMs,
      outcome: c.res.status >= 500 ? 'error' : 'ok',
    });
  }
  if (!shouldLogHttp()) return;
  log.info('http', {
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: durationMs,
  });
}
