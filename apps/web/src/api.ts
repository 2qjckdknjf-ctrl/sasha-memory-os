const API_BASE = import.meta.env.VITE_MEMORY_API_URL ?? 'http://localhost:8787';

export async function apiGet<T>(
  path: string,
  subjectId: string,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'x-subject-id': subjectId },
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
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-subject-id': subjectId,
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
