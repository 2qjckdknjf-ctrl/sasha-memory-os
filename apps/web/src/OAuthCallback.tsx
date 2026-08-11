import { useEffect, useState } from 'react';
import { apiPost } from './api';

const OWNER = '33333333-3333-4333-8333-333333333301';

/**
 * Handles provider redirect: /oauth/callback?code=&state=
 * Completes Memory OS OAuth broker without putting tokens in the URL history longer than needed.
 */
export function OAuthCallback() {
  const [status, setStatus] = useState('Completing OAuth…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') ?? '';
    const state = params.get('state') ?? '';
    const oauthError = params.get('error');
    if (oauthError) {
      setError(oauthError);
      setStatus('OAuth provider returned an error');
      return;
    }
    if (!state) {
      setError('missing state');
      setStatus('Invalid OAuth callback');
      return;
    }
    void (async () => {
      try {
        const done = await apiPost<{
          exchangeMode?: string;
          vaultRef?: string;
          status?: string;
        }>('/v1/oauth/callback', OWNER, {
          state,
          code,
          actor_subject_id: OWNER,
        }, 'owner');
        setStatus(
          `Connected (${done.exchangeMode ?? done.status ?? 'ok'}). You can close this tab.`,
        );
        window.history.replaceState({}, '', '/oauth/callback');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('OAuth callback failed');
      }
    })();
  }, []);

  return (
    <main className="app" style={{ padding: '2rem', maxWidth: 640 }}>
      <h1>Memory OS OAuth</h1>
      <p>{status}</p>
      {error ? <p className="error">{error}</p> : null}
      <p>
        <a href="/">Back to control surface</a>
      </p>
    </main>
  );
}
