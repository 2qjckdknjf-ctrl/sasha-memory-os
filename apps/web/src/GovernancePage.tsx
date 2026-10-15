import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from './api';
import {
  type Actor,
  type BackendMode,
  type GovernanceOverview,
  type ProcessingJobRecord,
  type ProjectRecord,
  type RoutingInboxItem,
  WORKSPACE_ID,
  formatTimestamp,
} from './controlCenter';

type Props = {
  actor: Actor;
  backend: BackendMode;
  backendResolved: boolean;
  subjectId: string;
  projectId: string | null;
  projects: ProjectRecord[];
  scopeLabel: string;
  scopePanel: ReactNode;
};

type RoutingDraft = {
  projectId: string;
  classification:
    | 'KEEP_AISTROYKA'
    | 'MOVE_TO_MEMORY_OS'
    | 'MOVE_TO_HIAIR'
    | 'REVIEW_REQUIRED';
  reason: string;
};

const EMPTY_DRAFT: RoutingDraft = {
  projectId: '',
  classification: 'MOVE_TO_MEMORY_OS',
  reason: '',
};

function freshnessLabel(status: GovernanceOverview['freshness']['status']): string {
  if (status === 'fresh') return 'Свежие данные';
  if (status === 'stale') return 'Данные устарели';
  return 'Свежесть неизвестна';
}

function optionalTimestamp(value?: string | null): string {
  return value ? formatTimestamp(value) : 'нет данных';
}

export function GovernancePage({
  actor,
  backend,
  backendResolved,
  subjectId,
  projectId,
  projects,
  scopeLabel,
  scopePanel,
}: Props) {
  const [overview, setOverview] = useState<GovernanceOverview | null>(null);
  const [routingItems, setRoutingItems] = useState<RoutingInboxItem[]>([]);
  const [jobs, setJobs] = useState<ProcessingJobRecord[]>([]);
  const [routingDrafts, setRoutingDrafts] = useState<Record<string, RoutingDraft>>({});
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = actor === 'owner';
  const controlsEnabled = isOwner && backend !== 'local';

  const load = useCallback(async () => {
    if (!backendResolved || !isOwner) return;
    if (backend === 'local') {
      setOverview(null);
      setRoutingItems([]);
      setJobs([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const projectQuery = projectId ? `&project_id=${encodeURIComponent(projectId)}` : '';
      const [overviewResult, inboxResult, jobsResult] = await Promise.all([
        apiGet<GovernanceOverview>(
          `/v1/governance/overview?workspace_id=${WORKSPACE_ID}${projectQuery}`,
          subjectId,
          actor,
        ),
        apiGet<{ items?: RoutingInboxItem[] }>(
          `/v1/routing/unclassified?workspace_id=${WORKSPACE_ID}&limit=50`,
          subjectId,
          actor,
        ),
        apiGet<{ jobs?: ProcessingJobRecord[] }>(
          `/v1/jobs?workspace_id=${WORKSPACE_ID}&statuses=queued,running,failed,dead_letter&limit=50`,
          subjectId,
          actor,
        ),
      ]);
      setOverview(overviewResult);
      setRoutingItems(inboxResult.items ?? []);
      setJobs(jobsResult.jobs ?? []);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [actor, backend, backendResolved, isOwner, projectId, subjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateDraft(memoryId: string, patch: Partial<RoutingDraft>) {
    setRoutingDrafts((current) => ({
      ...current,
      [memoryId]: { ...(current[memoryId] ?? EMPTY_DRAFT), ...patch },
    }));
  }

  async function correctRouting(item: RoutingInboxItem) {
    const draft = routingDrafts[item.memoryId] ?? EMPTY_DRAFT;
    if (!draft.projectId || draft.reason.trim().length < 3) {
      setError('Выберите проект и укажите причину решения маршрутизации.');
      return;
    }
    setPendingAction(`routing:${item.memoryId}`);
    setError(null);
    try {
      await apiPost(
        `/v1/routing/${item.memoryId}/correct`,
        subjectId,
        {
          corrected_project_id: draft.projectId,
          classification: draft.classification,
          reason: draft.reason,
          source_evidence: {
            source_event_id: item.sourceEventId ?? null,
            surface: 'control-center',
          },
        },
        actor,
      );
      await load();
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setPendingAction(null);
    }
  }

  async function deadLetterStale() {
    setPendingAction('dead-letter');
    setError(null);
    try {
      await apiPost(
        '/v1/jobs/dead-letter-stale',
        subjectId,
        { workspace_id: WORKSPACE_ID, older_than_minutes: 60 },
        actor,
      );
      await load();
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setPendingAction(null);
    }
  }

  async function replayJob(job: ProcessingJobRecord) {
    setPendingAction(`replay:${job.id}`);
    setError(null);
    try {
      await apiPost(
        `/v1/jobs/${job.id}/replay`,
        subjectId,
        { actor_subject_id: subjectId, resync: false },
        actor,
      );
      await load();
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Управление</p>
        <h1>Состояние и контроль Memory OS</h1>
        <p className="lede">
          Единая owner-панель по {scopeLabel}: свежесть, маршрутизация, очереди и безопасные
          переходы ко всем governance-поверхностям без доступа к базе данных.
        </p>
      </header>

      {scopePanel}

      {!isOwner ? (
        <div className="banner banner--warn" role="alert">
          Эта поверхность доступна только владельцу. Переключение demo-актора здесь отсутствует.
        </div>
      ) : null}
      {backendResolved && backend === 'local' ? (
        <div className="banner" role="status">
          Локальный preview не изображает production health. Подключите API backend для реальных
          очередей и свежести.
        </div>
      ) : null}
      {error ? <div className="banner banner--warn" role="alert">{error}</div> : null}

      <div className="cta-row">
        <button type="button" disabled={!controlsEnabled || loading} onClick={() => void load()}>
          Обновить состояние
        </button>
        <Link to="/connections" className="button-link button-link--secondary">Источники</Link>
        <Link to="/conflicts" className="button-link button-link--secondary">Review и конфликты</Link>
        <Link to="/audit" className="button-link button-link--secondary">Аудит</Link>
        <Link to="/privacy" className="button-link button-link--secondary">Приватность</Link>
      </div>

      <section className="panel">
        <h2>Обзор здоровья и свежести</h2>
        {loading && !overview ? <p className="hint">Загружаю реальное состояние…</p> : null}
        {overview ? (
          <>
            <div className="stat-grid">
              <article className="stat-card">
                <span className="stat-card__label">Свежесть</span>
                <strong>{freshnessLabel(overview.freshness.status)}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-card__label">Требуют review</span>
                <strong>{overview.memories.candidate + overview.memories.disputed}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-card__label">UNCLASSIFIED</span>
                <strong>{overview.routing.unclassified}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-card__label">Проблемы подключений</span>
                <strong>{overview.connections.needsAttention}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-card__label">Failed / dead-letter</span>
                <strong>{overview.jobs.failed + overview.jobs.deadLetter}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-card__label">Outbox pending</span>
                <strong>{overview.outbox.pending}</strong>
              </article>
            </div>
            <p className="hint">
              Последняя память: {optionalTimestamp(overview.freshness.latestMemoryAt)} · source event:{' '}
              {optionalTimestamp(overview.freshness.latestSourceEventAt)} · sync:{' '}
              {optionalTimestamp(overview.freshness.latestConnectorSyncAt)} · SLA:{' '}
              {Math.round(overview.freshness.slaSeconds / 3600)} ч.
            </p>
          </>
        ) : (
          <p className="hint">Production-метрики не загружены.</p>
        )}
      </section>

      <section className="panel" id="routing-inbox">
        <h2>UNCLASSIFIED и routing corrections ({routingItems.length})</h2>
        <p className="hint">
          В списке нет raw content: только provenance и поля, необходимые владельцу для решения.
        </p>
        {routingItems.length === 0 ? <p className="hint">Неразобранных маршрутов нет.</p> : null}
        <ul className="timeline" aria-label="UNCLASSIFIED inbox">
          {routingItems.map((item) => {
            const draft = routingDrafts[item.memoryId] ?? EMPTY_DRAFT;
            return (
              <li className="item" key={item.memoryId}>
                <div className="meta">
                  <span className="badge state">{item.classification}</span>
                  <span>{item.memoryType}</span>
                  <span>{formatTimestamp(item.recordedAt)}</span>
                </div>
                <h3><Link to={`/memories/${item.memoryId}`}>{item.title}</Link></h3>
                <p>{item.reason}</p>
                <div className="form">
                  <label>
                    Целевой проект
                    <select
                      value={draft.projectId}
                      disabled={!controlsEnabled}
                      onChange={(event) => updateDraft(item.memoryId, { projectId: event.target.value })}
                    >
                      <option value="">Выберите проект…</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>{project.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Решение
                    <select
                      value={draft.classification}
                      disabled={!controlsEnabled}
                      onChange={(event) =>
                        updateDraft(item.memoryId, {
                          classification: event.target.value as RoutingDraft['classification'],
                        })
                      }
                    >
                      <option value="MOVE_TO_MEMORY_OS">Memory OS</option>
                      <option value="KEEP_AISTROYKA">Оставить в AISTROYKA</option>
                      <option value="MOVE_TO_HIAIR">Перенести в HiAir</option>
                      <option value="REVIEW_REQUIRED">Оставить на review</option>
                    </select>
                  </label>
                  <label>
                    Причина
                    <input
                      value={draft.reason}
                      disabled={!controlsEnabled}
                      onChange={(event) => updateDraft(item.memoryId, { reason: event.target.value })}
                    />
                  </label>
                  <div className="actions">
                    <button
                      type="button"
                      disabled={!controlsEnabled || pendingAction === `routing:${item.memoryId}`}
                      onClick={() => void correctRouting(item)}
                    >
                      Применить correction
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel" id="job-queue">
        <h2>Очереди, dead letters и replay ({jobs.length})</h2>
        <div className="actions">
          <button
            type="button"
            disabled={!controlsEnabled || pendingAction === 'dead-letter'}
            onClick={() => void deadLetterStale()}
          >
            Перевести зависшие jobs в dead-letter
          </button>
        </div>
        {jobs.length === 0 ? <p className="hint">Активных или аварийных jobs нет.</p> : null}
        <ul className="timeline" aria-label="Очередь processing jobs">
          {jobs.map((job) => (
            <li className="item" key={job.id}>
              <div className="meta">
                <span className="badge state">{job.status}</span>
                <span>{job.jobType}</span>
                <span>attempt {job.attempt}</span>
                <span>{formatTimestamp(job.updatedAt)}</span>
              </div>
              <h3><code>{job.id}</code></h3>
              {job.error ? <p>{job.error}</p> : null}
              {job.connectionId ? <p className="hint">Connection: {job.connectionId}</p> : null}
              {job.status === 'dead_letter' && job.jobType === 'connector_sync' ? (
                <button
                  type="button"
                  disabled={!controlsEnabled || pendingAction === `replay:${job.id}`}
                  onClick={() => void replayJob(job)}
                >
                  Безопасно повторить
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Все governance-поверхности</h2>
        <div className="cta-row">
          <Link to="/projects" className="button-link button-link--secondary">Projects и snapshots</Link>
          <Link to="/connections" className="button-link button-link--secondary">Scope, sync, cursors, revoke</Link>
          <Link to="/conflicts" className="button-link button-link--secondary">Review и contradictions</Link>
          <Link to="/entities" className="button-link button-link--secondary">Knowledge graph</Link>
          <Link to="/audit" className="button-link button-link--secondary">Audit trail</Link>
          <Link to="/privacy" className="button-link button-link--secondary">Export, delete, retention</Link>
          <Link to="/search" className="button-link button-link--secondary">Search ranking evidence</Link>
        </div>
      </section>
    </section>
  );
}
