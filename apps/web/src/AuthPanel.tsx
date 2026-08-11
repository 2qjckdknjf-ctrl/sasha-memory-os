import { useEffect, useState } from 'react';
import { apiPost, setBoundAuthUserId } from './api';
import { createBrowserSupabase, type Session } from './supabase';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OWNER = '33333333-3333-4333-8333-333333333301';

type Props = {
  onBound: (authUserId: string, subjectId: string) => void;
  onUnbound?: () => void;
};

export function AuthPanel({ onBound, onUnbound }: Props) {
  const [email, setEmail] = useState('pilot@example.com');
  const [password, setPassword] = useState('memory-os-pilot');
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = createBrowserSupabase();

  useEffect(() => {
    if (!client) return;
    void client.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    if (!session?.user) {
      setBoundAuthUserId(null);
      onUnbound?.();
      return;
    }
    void (async () => {
      setError(null);
      try {
        const bound = await apiPost<{
          subjectId?: string;
          authUserId?: string;
        }>(
          '/v1/auth/bind',
          OWNER,
          {
            workspace_id: WORKSPACE_ID,
            auth_user_id: session.user.id,
            email: session.user.email ?? undefined,
            display_name:
              (session.user.user_metadata?.display_name as string | undefined) ??
              session.user.email?.split('@')[0],
            acting_subject_id: OWNER,
          },
          'owner',
        );
        if (bound.subjectId && bound.authUserId) {
          onBound(bound.authUserId, bound.subjectId);
          setStatus(`Bound subject ${bound.subjectId.slice(0, 8)}…`);
        }
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [session, onBound, onUnbound]);

  if (!client) {
    return (
      <section className="panel">
        <h2>Supabase Auth</h2>
        <p className="meta">
          Set `VITE_MEMORY_OS_SUPABASE_URL` and `VITE_MEMORY_OS_SUPABASE_ANON_KEY`
          to enable browser session → subject bind.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Supabase Auth</h2>
      {session?.user ? (
        <div>
          <p className="meta">
            Signed in as {session.user.email ?? session.user.id}
          </p>
          {status ? <p className="meta">{status}</p> : null}
          <button
            type="button"
            onClick={() => {
              void client.auth.signOut();
            }}
          >
            Sign out
          </button>
        </div>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            void (async () => {
              const { error: signError } = await client.auth.signInWithPassword({
                email,
                password,
              });
              if (signError) {
                const created = await client.auth.signUp({ email, password });
                if (created.error) {
                  setError(created.error.message);
                  return;
                }
                setStatus('Signed up — check email confirm if required, or retry sign-in.');
                return;
              }
              setStatus('Signed in');
            })();
          }}
        >
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button type="submit">Sign in / sign up</button>
        </form>
      )}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
