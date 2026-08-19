import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from './api';
import { AGENT_SCOPE_PREVIEWS, actorIdForPreview } from './agentScopes';
import {
  WORKSPACE_ID,
  type Actor,
  type AgentRightsActor,
  type AgentRightsResponse,
  type BackendMode,
  type MeResponse,
} from './controlCenter';

type Props = {
  actor: Actor;
  backend: BackendMode;
  backendResolved: boolean;
  me: MeResponse | null;
  subjectId: string;
};

function buildPreviewFallback(): AgentRightsActor[] {
  return AGENT_SCOPE_PREVIEWS.map((preview) => ({
    subjectId: actorIdForPreview(preview.actor),
    externalKey: preview.actor,
    displayName: preview.displayName,
    kind: preview.kind,
    isOwner: preview.actor === 'owner',
    scopes: preview.capabilities,
    capabilities: preview.capabilities,
    rights: preview.rights.map((right) => ({
      effect: 'allow',
      resourceType: right.resource,
      projectId: null,
      actions: [right.access],
      sensitivityMax: preview.sensitivity,
      source: 'preview',
    })),
  }));
}

export function AgentScopesPage({
  actor,
  backend,
  backendResolved,
  me,
  subjectId,
}: Props) {
  const currentActorName = me?.actor.displayName ?? 'Текущий актор';
  const currentActorKey = me?.actor.externalKey ?? 'unknown';
  const currentActorId = me?.actor.id ?? me?.subjectId ?? '—';
  const [rights, setRights] = useState<AgentRightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRights() {
      if (!backendResolved || backend === 'local') {
        setRights(null);
        setLoading(false);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await apiGet<AgentRightsResponse>(
          `/v1/agents/rights?workspace_id=${WORKSPACE_ID}`,
          subjectId,
          actor,
        );
        if (!cancelled) {
          setRights(result);
        }
      } catch (loadError) {
        if (!cancelled) {
          setRights(null);
          setError((loadError as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadRights();
    return () => {
      cancelled = true;
    };
  }, [actor, backend, backendResolved, subjectId]);

  const actorRows = useMemo(
    () => rights?.actors ?? buildPreviewFallback(),
    [rights],
  );

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Агенты</p>
        <h1>Агенты и права доступа</h1>
        <p className="lede">
          Экран показывает текущего актора через <code>/v1/me</code> и матрицу прав через реальный
          backend endpoint <code>/v1/agents/rights</code>, если он доступен.
        </p>
      </header>

      <div className="cta-row">
        <Link to="/connections" className="button-link">
          Открыть подключения
        </Link>
        <Link to="/" className="button-link button-link--secondary">
          На главную
        </Link>
      </div>

      <div className="grid surface-grid">
        <section className="panel">
          <h2>Текущий актор в продукте</h2>
          <p className="hint">
            Этот блок показывает, чьи права сейчас используются в продуктовом интерфейсе. Если API
            недоступен, Control Center падает обратно на локальный preview.
          </p>
          <dl className="memory-inspector__facts">
            <div className="memory-inspector__fact">
              <dt>Имя</dt>
              <dd>{currentActorName}</dd>
            </div>
            <div className="memory-inspector__fact">
              <dt>Ключ</dt>
              <dd>{currentActorKey}</dd>
            </div>
            <div className="memory-inspector__fact">
              <dt>Subject ID</dt>
              <dd>{currentActorId}</dd>
            </div>
            <div className="memory-inspector__fact">
              <dt>Роль</dt>
              <dd>{me?.isOwner ? 'owner' : me?.actor.kind ?? 'agent'}</dd>
            </div>
            <div className="memory-inspector__fact">
              <dt>Источник</dt>
              <dd>{backend === 'local' ? 'Локальный preview' : '/v1/me + /v1/agents/rights'}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2>Статус матрицы прав</h2>
          <ul className="surface-bullets">
            <li>Write API для ACL по-прежнему не добавлялся: экран только читает текущую матрицу.</li>
            <li>ROMA по-прежнему не показывается, потому что его нет в текущих domain types / seed.</li>
            <li>
              {backend === 'local'
                ? 'Сейчас открыт локальный preview без API.'
                : loading
                  ? 'Загружаю live matrix…'
                  : error
                    ? `Не удалось загрузить live matrix: ${error}`
                    : 'Права ниже пришли из backend без preview-файла.'}
            </li>
          </ul>
        </section>
      </div>

      <section className="panel">
        <h2>{rights ? 'Живая матрица прав' : 'Fallback preview прав'}</h2>
        <p className="hint">
          Это не редактор ACL. Ниже только текущие read-only права владельца, ChatGPT и Cursor.
        </p>
        <div className="stat-grid">
          {actorRows.map((row) => {
            const isCurrentActor = me?.actor.id === row.subjectId;
            return (
              <article className="stat-card" key={row.subjectId}>
                <div className="meta">
                  <span className="badge state">{row.kind ?? 'actor'}</span>
                  {isCurrentActor ? <span>текущий актор</span> : null}
                </div>
                <strong>{row.displayName ?? row.externalKey ?? row.subjectId}</strong>
                <p className="hint">
                  {row.isOwner
                    ? 'Owner через membership'
                    : `Actor key: ${row.externalKey ?? 'unknown'}`}
                </p>
                <p className="section-subtitle">Scopes</p>
                <ul className="surface-bullets">
                  {row.scopes.map((scope) => (
                    <li key={`${row.subjectId}-${scope}`}>
                      <code>{scope}</code>
                    </li>
                  ))}
                </ul>
                <p className="section-subtitle">Подробные права</p>
                <ul className="surface-bullets">
                  {row.rights.map((right, index) => (
                    <li key={`${row.subjectId}-${right.resourceType}-${index}`}>
                      <strong>{right.resourceType}</strong>: {right.actions.join(', ') || 'all'}
                      {right.projectId ? ` · project ${right.projectId.slice(0, 8)}…` : ''}
                      {right.sensitivityMax ? ` · <= ${right.sensitivityMax}` : ''}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}
