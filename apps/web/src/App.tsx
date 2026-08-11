import { useMemo, useState } from 'react';
import {
  createSeededStore,
  type Handoff,
  type MemoryRecord,
  type ProjectStateVersion,
} from '@memory-os/domain';

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
  | { kind: 'decision'; at: string; memory: MemoryRecord }
  | { kind: 'state'; at: string; state: ProjectStateVersion }
  | { kind: 'handoff'; at: string; handoff: Handoff };

export function App() {
  const [store] = useState(() => createSeededStore());
  const [actor, setActor] = useState<Actor>('cursor');
  const [title, setTitle] = useState('Continue remediation after audit');
  const [content, setContent] = useState(
    'Next engineering work follows the Slice 01 kickoff decision.',
  );
  const [tick, setTick] = useState(0);

  const timeline = useMemo(() => {
    void tick;
    const entries: TimelineEntry[] = [];
    for (const memory of store.listCurrentMemories(WORKSPACE_ID, PROJECT_ID)) {
      if (memory.memoryType === 'decision') {
        entries.push({
          kind: 'decision',
          at: memory.recordedAt,
          memory,
        });
      }
    }
    const state = store.getProjectState(PROJECT_ID);
    if (state) {
      entries.push({ kind: 'state', at: state.createdAt, state });
    }
    for (const handoff of store.handoffs.get(PROJECT_ID) ?? []) {
      entries.push({ kind: 'handoff', at: handoff.createdAt, handoff });
    }
    return entries.sort((a, b) => b.at.localeCompare(a.at));
  }, [store, tick]);

  const state = store.getProjectState(PROJECT_ID);

  function refresh() {
    setTick((n) => n + 1);
  }

  function onStoreDecision() {
    store.createDecision({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      title,
      content,
      actorSubjectId: actors[actor],
      idempotencyKey: `web/${actor}/${Date.now()}`,
    });
    refresh();
  }

  function onCreateHandoff() {
    store.createHandoff({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      fromSubjectId: actors.cursor,
      toSubjectId: actors.chatgpt,
      payload: {
        completed: ['Loaded project context from Memory OS'],
        artifacts: [],
        validation: ['typecheck', 'unit tests'],
        open_items: ['Apply remote seed verification'],
        blockers: [],
        recommended_next: ['Continue Web control center'],
      },
    });
    refresh();
  }

  return (
    <main className="app">
      <h1 className="brand">Sasha Memory OS</h1>
      <p className="lede">
        Control center timeline for AISTROYKA: current decisions, project state,
        and agent handoffs. Demo store is seeded locally; Supabase project
        <code> sasha-memory-os </code>
        holds the canonical schema.
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
        <button type="button" onClick={onCreateHandoff}>
          Cursor handoff
        </button>
      </div>

      <div className="grid">
        <section className="panel">
          <h2>Project timeline</h2>
          <ul className="timeline">
            {timeline.map((entry) => {
              if (entry.kind === 'decision') {
                return (
                  <li className="item" key={`d-${entry.memory.id}`}>
                    <div className="meta">
                      <span className="badge decision">decision</span>
                      <span>{entry.memory.status}</span>
                      <span>{new Date(entry.at).toLocaleString()}</span>
                    </div>
                    <h3>{entry.memory.title}</h3>
                    <p>{entry.memory.content}</p>
                  </li>
                );
              }
              if (entry.kind === 'state') {
                return (
                  <li className="item" key={`s-${entry.state.id}`}>
                    <div className="meta">
                      <span className="badge state">state v{entry.state.version}</span>
                      <span>{new Date(entry.at).toLocaleString()}</span>
                    </div>
                    <h3>{entry.state.summary ?? entry.state.state.stage}</h3>
                    <p>Next: {entry.state.state.next.join(', ') || '—'}</p>
                  </li>
                );
              }
              return (
                <li className="item" key={`h-${entry.handoff.id}`}>
                  <div className="meta">
                    <span className="badge handoff">handoff</span>
                    <span>{new Date(entry.at).toLocaleString()}</span>
                  </div>
                  <h3>Agent handoff</h3>
                  <p>
                    {entry.handoff.payload.recommended_next.join(', ') ||
                      entry.handoff.payload.completed.join(', ')}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="panel">
          <h2>Working state</h2>
          {state ? (
            <div className="state-block">
              <div>
                Stage: <strong>{state.state.stage}</strong>
              </div>
              <div>Completed: {state.state.completed.join(', ') || '—'}</div>
              <div>Next: {state.state.next.join(', ') || '—'}</div>
              <div>
                Active decisions: {state.state.active_decisions.length}
              </div>
            </div>
          ) : (
            <p className="hint">No project state yet.</p>
          )}

          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              onStoreDecision();
            }}
          >
            <label>
              Decision title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
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
            <p className="hint">
              Writes go to the in-browser MemoryStore for now; API/MCP use the
              same contracts.
            </p>
          </form>
        </aside>
      </div>
    </main>
  );
}
