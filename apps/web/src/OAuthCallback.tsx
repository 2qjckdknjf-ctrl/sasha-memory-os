import { useEffect, useState } from 'react';
import { apiPost } from './api';
import {
  clearPendingOAuthSession,
  readPendingOAuthSession,
} from './oauthSession';

const OWNER = '33333333-3333-4333-8333-333333333301';
const OWNER_ACTOR = 'owner';

/**
 * Handles provider redirect: /oauth/callback?code=&state=
 * Completes Memory OS OAuth broker without putting tokens in the URL history longer than needed.
 */
export function OAuthCallback() {
  const [status, setStatus] = useState('Завершаю OAuth…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') ?? '';
    const state = params.get('state') ?? '';
    const oauthError = params.get('error');
    const pendingSession = readPendingOAuthSession();
    const subjectId = pendingSession?.subjectId ?? OWNER;
    const actorKey = pendingSession?.actorKey ?? OWNER_ACTOR;
    if (oauthError) {
      setError(oauthError);
      setStatus('Провайдер OAuth вернул ошибку');
      clearPendingOAuthSession();
      return;
    }
    if (!state) {
      setError('missing state');
      setStatus('Некорректный OAuth callback');
      clearPendingOAuthSession();
      return;
    }
    void (async () => {
      try {
        const done = await apiPost<{
          exchangeMode?: string;
          vaultRef?: string;
          status?: string;
        }>('/v1/oauth/callback', subjectId, {
          state,
          code,
          actor_subject_id: subjectId,
        }, actorKey);
        setStatus(
          `Подключение завершено (${done.exchangeMode ?? done.status ?? 'ok'}). Вкладку можно закрыть.`,
        );
        window.history.replaceState({}, '', '/oauth/callback');
        clearPendingOAuthSession();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('Не удалось завершить OAuth callback');
      }
    })();
  }, []);

  return (
    <main className="app" style={{ padding: '2rem', maxWidth: 640 }}>
      <h1>Memory OS OAuth</h1>
      <p>{status}</p>
      {error ? <p className="error">{error}</p> : null}
      <p>
        <a href="/">Вернуться в Control Center</a>
      </p>
    </main>
  );
}
