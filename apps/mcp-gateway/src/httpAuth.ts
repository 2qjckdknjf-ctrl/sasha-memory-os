import type { IncomingHttpHeaders } from 'node:http';

function normalizeHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return normalizeHeaderValue(value[0]);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isMcpHttpAuthRequired(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const flag = (env.MEMORY_OS_REQUIRE_API_AUTH ?? '').trim().toLowerCase();
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  const name = (env.MEMORY_OS_ENV ?? 'local').trim().toLowerCase();
  return name !== 'local' && name !== 'test';
}

export function extractMcpHttpApiSecret(
  headers: IncomingHttpHeaders,
): string | null {
  const header = normalizeHeaderValue(headers['x-memory-os-api-secret']);
  if (header) return header;
  const auth = normalizeHeaderValue(headers.authorization);
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    return token || null;
  }
  return null;
}

export function mcpHttpApiSecretMatches(
  provided: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = env.MEMORY_OS_API_SECRET?.trim();
  if (!expected) return false;
  return Boolean(provided && provided === expected);
}
