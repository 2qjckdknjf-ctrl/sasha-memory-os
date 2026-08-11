import { randomUUID } from 'node:crypto';
import type { Context, Next } from 'hono';

function shouldLogHttp(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.MEMORY_OS_HTTP_LOG ?? '').trim().toLowerCase();
  if (flag === '0' || flag === 'false') return false;
  if (flag === '1' || flag === 'true') return true;
  const name = (env.MEMORY_OS_ENV ?? 'local').trim().toLowerCase();
  return name === 'staging' || name === 'production' || name === 'prod';
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
  if (!shouldLogHttp()) return;
  console.log(
    JSON.stringify({
      msg: 'http',
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - started,
    }),
  );
}
