const API_BASE = import.meta.env.VITE_MEMORY_API_URL ?? 'http://localhost:8787';

let boundAuthUserId: string | null = null;

export function setBoundAuthUserId(authUserId: string | null): void {
  boundAuthUserId = authUserId;
}

function authHeaders(
  subjectId: string,
  actorKey?: string,
): Record<string, string> {
  const headers: Record<string, string> = { 'x-subject-id': subjectId };
  if (actorKey) headers['x-actor-key'] = actorKey;
  if (boundAuthUserId) headers['x-auth-user-id'] = boundAuthUserId;
  return headers;
}

export async function apiGet<T>(
  path: string,
  subjectId: string,
  actorKey?: string,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: authHeaders(subjectId, actorKey),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(
  path: string,
  subjectId: string,
  body: unknown,
  actorKey?: string,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders(subjectId, actorKey),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(
  path: string,
  subjectId: string,
  body: unknown,
  actorKey?: string,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...authHeaders(subjectId, actorKey),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export async function apiHealth(): Promise<{ backend?: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) return null;
    return (await res.json()) as { backend?: string };
  } catch {
    return null;
  }
}
