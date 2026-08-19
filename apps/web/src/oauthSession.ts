const OAUTH_SESSION_KEY = 'memory-os.oauth.pending';

export type PendingOAuthSession = {
  subjectId: string;
  actorKey: string;
};

export function storePendingOAuthSession(session: PendingOAuthSession): void {
  try {
    window.sessionStorage.setItem(OAUTH_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Best-effort only; OAuth can still fall back to owner preview flow.
  }
}

export function readPendingOAuthSession(): PendingOAuthSession | null {
  try {
    const raw = window.sessionStorage.getItem(OAUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingOAuthSession>;
    if (!parsed.subjectId || !parsed.actorKey) return null;
    return {
      subjectId: parsed.subjectId,
      actorKey: parsed.actorKey,
    };
  } catch {
    return null;
  }
}

export function clearPendingOAuthSession(): void {
  try {
    window.sessionStorage.removeItem(OAUTH_SESSION_KEY);
  } catch {
    // No-op.
  }
}
