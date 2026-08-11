import { useEffect, useMemo, useState } from 'react';
import { createSeededStore } from '@memory-os/domain';
import { apiGet, apiHealth, apiPatch, apiPost } from './api';


const PROJECT_ID = '44444444-4444-4444-8444-444444444401';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CURSOR = '33333333-3333-4333-8333-333333333303';
const CHATGPT = '33333333-3333-4333-8333-333333333302';

type Actor = 'owner' | 'chatgpt' | 'cursor';

const actors: Record<Actor, string> = {
  owner: '33333333-3333-4333-8333-333333333301',
  chatgpt: CHATGPT,
  cursor: CURSOR,
};

type TimelineEntry =
  | { kind: 'decision'; at: string; title: string; content: string; status: string }
  | { kind: 'state'; at: string; summary: string; version: number; next: string }
  | { kind: 'handoff'; at: string; summary: string };

type RemoteContext = {
  decisions?: Array<Record<string, unknown>>;
  state?: Record<string, unknown> | null;
  latestHandoff?: Record<string, unknown> | null;
};

export function App() {
  const [localStore] = useState(() => createSeededStore());
  const [actor, setActor] = useState<Actor>('cursor');
  const [backend, setBackend] = useState<'supabase' | 'memory-store' | 'local'>('local');
  const [remote, setRemote] = useState<RemoteContext | null>(null);
  const [search, setSearch] = useState('Slice');
  const [hits, setHits] = useState<Array<{ memory?: { title?: string; content?: string } }>>([]);
  const [title, setTitle] = useState('Continue remediation after audit');
  const [content, setContent] = useState(
    'Next engineering work follows the Slice 01 kickoff decision.',
  );
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [connections, setConnections] = useState<
    Array<{
      id?: string;
      connectorId?: string;
      displayName?: string;
      status?: string;
      lastSyncAt?: string | null;
      lastError?: string | null;
    }>
  >([]);
  const [captureTitle, setCaptureTitle] = useState('Meeting note');
  const [captureText, setCaptureText] = useState(
    'Manual capture alpha: quarantine → hash → chunks → candidate memory.',
  );
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  const [docTitle, setDocTitle] = useState('Uploaded brief');
  const [docFile, setDocFile] = useState<File | null>(null);

  const subjectId = actors[actor];

  async function refreshRemote() {
    const health = await apiHealth();
    if (!health) {
      setBackend('local');
      setRemote(null);
      setConnections([
        {
          connectorId: 'github',
          displayName: 'AISTROYKA repos',
          status: 'connected',
        },
      ]);
      return;
    }
    setBackend((health.backend as 'supabase' | 'memory-store') ?? 'memory-store');
    const ctx = await apiGet<RemoteContext>(
      `/v1/projects/${PROJECT_ID}/context`,
      subjectId,
    );
    setRemote(ctx);
    const conn = await apiGet<{ connections: typeof connections }>(
      `/v1/connections?workspace_id=${WORKSPACE_ID}`,
      subjectId,
    );
    setConnections(conn.connections ?? []);
  }

  useEffect(() => {
    void refreshRemote().catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, tick]);

  const timeline = useMemo(() => {
    void tick;
    if (remote) {
      const entries: TimelineEntry[] = [];
      for (const d of remote.decisions ?? []) {
        entries.push({
          kind: 'decision',
          at: String(d.recorded_at ?? d.recordedAt ?? new Date().toISOString()),
          title: String(d.title ?? 'decision'),
          content: String(d.content ?? ''),
          status: String(d.status ?? 'verified'),
        });
      }
      if (remote.state) {
        const state = remote.state.state as { next?: string[] } | undefined;
        entries.push({
          kind: 'state',
          at: String(remote.state.created_at ?? new Date().toISOString()),
          summary: String(remote.state.summary ?? 'project state'),
          version: Number(remote.state.version ?? 0),
          next: (state?.next ?? []).join(', ') || '—',
        });
      }
      if (remote.latestHandoff) {
        const payload = remote.latestHandoff.payload as {
          recommended_next?: string[];
          completed?: string[];
        };
        entries.push({
          kind: 'handoff',
          at: String(remote.latestHandoff.created_at ?? new Date().toISOString()),
          summary:
            payload?.recommended_next?.join(', ') ||
            payload?.completed?.join(', ') ||
            'handoff',
        });
      }
      return entries.sort((a, b) => b.at.localeCompare(a.at));
    }

    const entries: TimelineEntry[] = [];
    for (const memory of localStore.listCurrentMemories(WORKSPACE_ID, PROJECT_ID)) {
      if (memory.memoryType === 'decision') {
        entries.push({
          kind: 'decision',
          at: memory.recordedAt,
          title: memory.title,
          content: memory.content,
          status: memory.status,
        });
      }
    }
    const state = localStore.getProjectState(PROJECT_ID);
    if (state) {
      entries.push({
        kind: 'state',
        at: state.createdAt,
        summary: state.summary ?? state.state.stage,
        version: state.version,
        next: state.state.next.join(', ') || '—',
      });
    }
    for (const handoff of localStore.handoffs.get(PROJECT_ID) ?? []) {
      entries.push({
        kind: 'handoff',
        at: handoff.createdAt,
        summary:
          handoff.payload.recommended_next.join(', ') ||
          handoff.payload.completed.join(', '),
      });
    }
    return entries.sort((a, b) => b.at.localeCompare(a.at));
  }, [localStore, remote, tick]);

  const stateSummary = useMemo(() => {
    if (remote?.state) {
      const st = remote.state.state as {
        stage?: string;
        completed?: string[];
        next?: string[];
        active_decisions?: string[];
      };
      return {
        stage: st.stage ?? '—',
        completed: (st.completed ?? []).join(', ') || '—',
        next: (st.next ?? []).join(', ') || '—',
        active: st.active_decisions?.length ?? 0,
      };
    }
    const state = localStore.getProjectState(PROJECT_ID);
    if (!state) return null;
    return {
      stage: state.state.stage,
      completed: state.state.completed.join(', ') || '—',
      next: state.state.next.join(', ') || '—',
      active: state.state.active_decisions.length,
    };
  }, [localStore, remote, tick]);

  async function onStoreDecision() {
    setError(null);
    try {
      if (backend !== 'local') {
        await apiPost('/v1/memories', subjectId, {
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          title,
          content,
          actor_subject_id: subjectId,
          idempotency_key: `web/${actor}/${Date.now()}`,
          importance: 0.7,
          confidence: 0.9,
          sensitivity: 'internal',
        });
      } else {
        localStore.createDecision({
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          title,
          content,
          actorSubjectId: subjectId,
          idempotencyKey: `web/${actor}/${Date.now()}`,
        });
      }
      setTick((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onCreateHandoff() {
    setError(null);
    try {
      if (backend !== 'local') {
        await apiPost('/v1/handoffs', subjectId, {
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          from_subject_id: CURSOR,
          to_subject_id: CHATGPT,
          idempotency_key: `web-handoff-${Date.now()}`,
          payload: {
            completed: ['Loaded project context from Memory OS'],
            artifacts: [],
            validation: ['typecheck', 'unit tests'],
            open_items: ['Keep expanding control center'],
            blockers: [],
            recommended_next: ['Wire search UX'],
          },
        });
      } else {
        localStore.createHandoff({
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          fromSubjectId: CURSOR,
          toSubjectId: CHATGPT,
          payload: {
            completed: ['Loaded project context from Memory OS'],
            artifacts: [],
            validation: ['typecheck', 'unit tests'],
            open_items: [],
            blockers: [],
            recommended_next: ['Wire search UX'],
          },
        });
      }
      setTick((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onSearch() {
    setError(null);
    try {
      if (backend !== 'local') {
        const result = await apiPost<{ hits: typeof hits }>('/v1/search', subjectId, {
          query: search,
          project_id: PROJECT_ID,
        });
        setHits(result.hits ?? []);
      } else {
        const { searchMemories } = await import('@memory-os/retrieval');
        setHits(
          searchMemories([...localStore.memories.values()], search, {
            projectId: PROJECT_ID,
          }).map((h) => ({ memory: h.memory })),
        );
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onCaptureDocument() {
    setError(null);
    if (!docFile) {
      setError('Choose a .txt, .pdf, or .docx file');
      return;
    }
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('failed to read file'));
        reader.onload = () => {
          const result = String(reader.result ?? '');
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.readAsDataURL(docFile);
      });

      if (backend !== 'local') {
        const result = await apiPost<{
          jobId?: string;
          process?: { memoryId?: string; chunkCount?: number };
          memoryId?: string;
          extractedChars?: number;
          filename?: string;
        }>('/v1/capture/document', subjectId, {
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          title: docTitle,
          filename: docFile.name,
          mime_type: docFile.type || undefined,
          content_base64: contentBase64,
          actor_subject_id: subjectId,
          idempotency_key: `web-doc-${Date.now()}`,
          process_now: true,
        });
        setLastCapture(
          `doc ${result.filename ?? docFile.name} · chars ${
            result.extractedChars ?? '?'
          } · memory ${result.process?.memoryId ?? result.memoryId ?? '?'}`,
        );
        setSearch(docTitle.split(' ')[0] ?? 'Uploaded');
      } else {
        setError('Document capture requires API backend (start dev:api)');
        return;
      }
      setTick((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onCaptureText() {
    setError(null);
    try {
      if (backend !== 'local') {
        const result = await apiPost<{
          eventId?: string;
          jobId?: string;
          process?: { memoryId?: string; chunkCount?: number };
          memoryId?: string;
        }>('/v1/capture/text', subjectId, {
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          title: captureTitle,
          text: captureText,
          actor_subject_id: subjectId,
          idempotency_key: `web-capture-${Date.now()}`,
          process_now: true,
        });
        setLastCapture(
          `job ${result.jobId ?? '?'} · memory ${
            result.process?.memoryId ?? result.memoryId ?? '?'
          } · chunks ${result.process?.chunkCount ?? 1}`,
        );
        setSearch(captureTitle.split(' ')[0] ?? 'Meeting');
      } else {
        const result = localStore.captureText({
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          title: captureTitle,
          text: captureText,
          actorSubjectId: subjectId,
          idempotencyKey: `web-capture-${Date.now()}`,
        });
        setLastCapture(`local memory ${result.memoryId}`);
      }
      setTick((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onBumpState() {
    setError(null);
    const expectedVersion = Number(remote?.state?.version ?? 1);
    const current =
      (remote?.state?.state as {
        stage?: string;
        completed?: string[];
        in_progress?: string[];
        blocked?: string[];
        next?: string[];
        risks?: string[];
        active_decisions?: string[];
      }) ?? {};
    try {
      if (backend !== 'local') {
        await apiPatch(`/v1/projects/${PROJECT_ID}/state`, subjectId, {
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          expected_version: expectedVersion,
          actor_subject_id: subjectId,
          idempotency_key: `web-bump-${Date.now()}`,
          summary: `State bumped by ${actor}`,
          state: {
            stage: current.stage ?? 'slice-01-ready',
            completed: current.completed ?? [],
            in_progress: current.in_progress ?? ['control-center'],
            blocked: current.blocked ?? [],
            next: ['connections health review', ...(current.next ?? [])].slice(0, 5),
            risks: current.risks ?? [],
            active_decisions: current.active_decisions ?? [],
          },
        });
      } else {
        localStore.upsertProjectState({
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          expectedVersion: localStore.getProjectState(PROJECT_ID)?.version ?? 0,
          actorSubjectId: subjectId,
          summary: `State bumped by ${actor}`,
          state: {
            stage: 'slice-01-ready',
            completed: ['product-design-audit'],
            in_progress: ['control-center'],
            blocked: [],
            next: ['connections health review'],
            risks: [],
            active_decisions: [],
          },
        });
      }
      setTick((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="app">
      <h1 className="brand">Sasha Memory OS</h1>
      <p className="lede">
        Control center for AISTROYKA — decisions, project state, handoffs, search.
        Backend: <strong>{backend}</strong>
        {backend === 'supabase' ? ' (live RPCs)' : null}
      </p>

      <div className="toolbar" role="group" aria-label="Actor">
        {(['owner', 'chatgpt', 'cursor'] as Actor[]).map((key) => (
          <button
            key={key}
            type="button"
            data-active={actor === key}
            onClick={() => setActor(key)}
          >
            {key}
          </button>
        ))}
        <button type="button" onClick={() => void onCreateHandoff()}>
          Cursor handoff
        </button>
        <button type="button" onClick={() => void onBumpState()}>
          Bump state
        </button>
        <button type="button" onClick={() => setTick((n) => n + 1)}>
          Refresh
        </button>
      </div>

      {error ? <p className="hint" style={{ color: 'var(--warn)' }}>{error}</p> : null}

      <div className="grid">
        <section className="panel">
          <h2>Project timeline</h2>
          <ul className="timeline">
            {timeline.map((entry, idx) => {
              if (entry.kind === 'decision') {
                return (
                  <li className="item" key={`d-${idx}-${entry.title}`}>
                    <div className="meta">
                      <span className="badge decision">decision</span>
                      <span>{entry.status}</span>
                      <span>{new Date(entry.at).toLocaleString()}</span>
                    </div>
                    <h3>{entry.title}</h3>
                    <p>{entry.content}</p>
                  </li>
                );
              }
              if (entry.kind === 'state') {
                return (
                  <li className="item" key={`s-${idx}-${entry.version}`}>
                    <div className="meta">
                      <span className="badge state">state v{entry.version}</span>
                      <span>{new Date(entry.at).toLocaleString()}</span>
                    </div>
                    <h3>{entry.summary}</h3>
                    <p>Next: {entry.next}</p>
                  </li>
                );
              }
              return (
                <li className="item" key={`h-${idx}-${entry.at}`}>
                  <div className="meta">
                    <span className="badge handoff">handoff</span>
                    <span>{new Date(entry.at).toLocaleString()}</span>
                  </div>
                  <h3>Agent handoff</h3>
                  <p>{entry.summary}</p>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="panel">
          <h2>Working state</h2>
          {stateSummary ? (
            <div className="state-block">
              <div>
                Stage: <strong>{stateSummary.stage}</strong>
              </div>
              <div>Completed: {stateSummary.completed}</div>
              <div>Next: {stateSummary.next}</div>
              <div>Active decisions: {stateSummary.active}</div>
            </div>
          ) : (
            <p className="hint">No project state yet.</p>
          )}

          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void onStoreDecision();
            }}
          >
            <label>
              Decision title
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <label>
              Content
              <textarea
                rows={4}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
              />
            </label>
            <button type="submit">Remember as {actor}</button>
          </form>

          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void onCaptureText();
            }}
          >
            <label>
              Capture title
              <input
                value={captureTitle}
                onChange={(e) => setCaptureTitle(e.target.value)}
                required
              />
            </label>
            <label>
              Text note
              <textarea
                rows={3}
                value={captureText}
                onChange={(e) => setCaptureText(e.target.value)}
                required
              />
            </label>
            <button type="submit">Capture text</button>
          </form>

          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void onCaptureDocument();
            }}
          >
            <label>
              Document title
              <input
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                required
              />
            </label>
            <label>
              File (.txt / .pdf / .docx)
              <input
                type="file"
                accept=".txt,.md,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                required
              />
            </label>
            <button type="submit">Capture document</button>
            {lastCapture ? <p className="meta">{lastCapture}</p> : null}
          </form>

          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void onSearch();
            }}
          >
            <label>
              Search
              <input value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <button type="submit">Search memories</button>
            <ul className="timeline">
              {hits.map((hit, i) => (
                <li className="item" key={`hit-${i}`}>
                  <h3>{hit.memory?.title ?? 'hit'}</h3>
                  <p>{hit.memory?.content ?? ''}</p>
                </li>
              ))}
            </ul>
          </form>
        </aside>
      </div>

      <section className="panel" style={{ marginTop: '1rem' }}>
        <h2>Connections</h2>
        <div className="actions" style={{ marginBottom: '0.75rem' }}>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                setError(null);
                try {
                  if (backend === 'local') {
                    setError('Connect stub requires API backend');
                    return;
                  }
                  await apiPost('/v1/connections', subjectId, {
                    workspace_id: WORKSPACE_ID,
                    connector_id: 'gmail',
                    display_name: 'Pilot inbox',
                    scopes: ['messages.metadata'],
                    status: 'connected',
                    actor_subject_id: subjectId,
                  }, actor);
                  setTick((n) => n + 1);
                } catch (err) {
                  setError((err as Error).message);
                }
              })();
            }}
          >
            Connect Gmail stub
          </button>
        </div>
        <ul className="timeline">
          {connections.map((c, i) => (
            <li className="item" key={`${c.id ?? c.connectorId}-${i}`}>
              <div className="meta">
                <span className="badge state">{c.status ?? 'unknown'}</span>
                <span>{c.connectorId}</span>
                {c.lastSyncAt ? (
                  <span>sync {new Date(c.lastSyncAt).toLocaleString()}</span>
                ) : null}
              </div>
              <h3>{c.displayName ?? c.connectorId}</h3>
              <p>{c.lastError ?? 'No sync errors reported.'}</p>
              {c.id && backend !== 'local' ? (
                <div className="actions">
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        setError(null);
                        try {
                          await apiPost(
                            `/v1/connections/${c.id}/status`,
                            subjectId,
                            {
                              status: 'reauth_required',
                              last_error: 'Stub reauth requested from Web',
                              actor_subject_id: subjectId,
                            },
                            actor,
                          );
                          setTick((n) => n + 1);
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      })();
                    }}
                  >
                    Reauth
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        setError(null);
                        try {
                          await apiPost(
                            `/v1/connections/${c.id}/status`,
                            subjectId,
                            {
                              status: 'revoked',
                              last_error: null,
                              actor_subject_id: subjectId,
                            },
                            actor,
                          );
                          setTick((n) => n + 1);
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      })();
                    }}
                  >
                    Revoke
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        setError(null);
                        try {
                          await apiPost(
                            `/v1/connections/${c.id}/status`,
                            subjectId,
                            {
                              status: 'connected',
                              last_error: null,
                              actor_subject_id: subjectId,
                            },
                            actor,
                          );
                          setTick((n) => n + 1);
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      })();
                    }}
                  >
                    Mark connected
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
