import type { Context, Next } from 'hono';

/** When true, mutating/ops routes require x-memory-os-api-secret / Bearer. */
export function isHttpApiAuthRequired(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const flag = (env.MEMORY_OS_REQUIRE_API_AUTH ?? '').trim().toLowerCase();
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  const name = (env.MEMORY_OS_ENV ?? 'local').trim().toLowerCase();
  return name !== 'local' && name !== 'test';
}

export function extractHttpApiSecret(c: Context): string | null {
  const header = c.req.header('x-memory-os-api-secret')?.trim();
  if (header) return header;
  const auth = c.req.header('authorization')?.trim();
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    return token || null;
  }
  return null;
}

export function httpApiSecretMatches(
  provided: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = env.MEMORY_OS_API_SECRET?.trim();
  if (!expected) return false;
  return Boolean(provided && provided === expected);
}

/** Protect cron/owner ops routes when auth is required for this environment. */
export async function requireHttpApiSecret(
  c: Context,
  next: Next,
): Promise<Response | void> {
  if (!isHttpApiAuthRequired()) {
    await next();
    return;
  }
  const provided = extractHttpApiSecret(c);
  if (!httpApiSecretMatches(provided)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
}
