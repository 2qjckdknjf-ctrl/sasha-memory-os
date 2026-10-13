import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet, apiPost } from './api';
import type {
  Actor,
  EntityGraphResponse,
  EntitySearchResponse,
  GraphRetrieveResponse,
} from './controlCenter';

type Props = {
  actor: Actor;
  backend: string;
  backendResolved: boolean;
  subjectId: string;
  projectId: string | null;
  scopeLabel: string;
  scopePanel: ReactNode;
};

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('501')) return 'Граф доступен только при подключённой базе Supabase.';
  if (message.includes('403')) return 'Нет доступа к графу этого проекта.';
  if (message.includes('404')) return 'Сущность не найдена или недоступна.';
  return `Не удалось загрузить граф: ${message}`;
}

function confidenceLabel(value: number | undefined): string {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
}

export function EntityGraphPage({
  actor,
  backend,
  backendResolved,
  subjectId,
  projectId,
  scopeLabel,
  scopePanel,
}: Props) {
  const { id: entityId } = useParams<{ id: string }>();
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<EntitySearchResponse | null>(null);
  const [detail, setDetail] = useState<EntityGraphResponse | null>(null);
  const [traversal, setTraversal] = useState<GraphRetrieveResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchEntities() {
    if (!projectId) {
      setError('Сначала выберите конкретный проект.');
      return;
    }
    if (backend === 'local') {
      setError('Граф доступен только при подключённой базе Supabase.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        project_id: projectId,
        query,
        limit: '20',
      });
      setSearchResult(
        await apiGet<EntitySearchResponse>(`/v1/entities?${params}`, subjectId, actor),
      );
    } catch (nextError) {
      setSearchResult(null);
      setError(describeError(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (!backendResolved || !entityId) return;
    if (backend === 'local') {
      setDetail(null);
      setError('Граф доступен только при подключённой базе Supabase.');
      return;
    }

    setLoading(true);
    setError(null);
    setTraversal(null);
    void apiGet<EntityGraphResponse>(`/v1/entities/${entityId}`, subjectId, actor)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setDetail(null);
          setError(describeError(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [actor, backend, backendResolved, entityId, subjectId]);

  async function runTraversal() {
    if (!detail) return;
    setLoading(true);
    setError(null);
    try {
      setTraversal(
        await apiPost<GraphRetrieveResponse>(
          '/v1/graph/retrieve',
          subjectId,
          {
            project_id: detail.projectId,
            seed_entity_ids: [detail.entity.id],
            max_hops: 2,
            max_nodes: 24,
            max_edges: 48,
            min_confidence: 0.7,
          },
          actor,
        ),
      );
    } catch (nextError) {
      setTraversal(null);
      setError(describeError(nextError));
    } finally {
      setLoading(false);
    }
  }

  if (entityId) {
    return (
      <section className="page">
        <header className="page-header">
          <p className="eyebrow">Граф знаний</p>
          <h1>{detail?.entity.canonicalName ?? 'Инспектор сущности'}</h1>
          <p className="lede">
            Связи, память-источник и доказательства для одной сущности.
          </p>
        </header>

        <div className="actions">
          <Link className="button-link" to="/entities">
            Назад к графу
          </Link>
          <button type="button" onClick={() => void runTraversal()} disabled={!detail || loading}>
            Показать окружение до 2 переходов
          </button>
        </div>

        {error ? <div className="banner banner--warn" role="alert">{error}</div> : null}
        {loading ? <p className="hint">Загружаю граф…</p> : null}

        {detail ? (
          <>
            <section className="panel">
              <h2>Сущность</h2>
              <dl className="memory-inspector__facts">
                <div className="memory-inspector__fact">
                  <dt>Класс</dt>
                  <dd>{detail.entity.entityClass}</dd>
                </div>
                <div className="memory-inspector__fact">
                  <dt>Уверенность</dt>
                  <dd>{confidenceLabel(detail.entity.confidence)}</dd>
                </div>
                <div className="memory-inspector__fact">
                  <dt>Стабильный ID</dt>
                  <dd><code>{detail.entity.stableId}</code></dd>
                </div>
                <div className="memory-inspector__fact">
                  <dt>Источник</dt>
                  <dd><code>{detail.entity.sourceRef}</code></dd>
                </div>
              </dl>
            </section>

            <section className="panel">
              <h2>Псевдонимы ({detail.aliases.length})</h2>
              <div className="timeline">
                {detail.aliases.map((alias) => (
                  <article className="item" key={alias.id ?? `${alias.alias}:${alias.sourceRef}`}>
                    <h3>{alias.alias}</h3>
                    <p>{confidenceLabel(alias.confidence)} · источник {alias.sourceRef}</p>
                  </article>
                ))}
                {detail.aliases.length === 0 ? <p className="hint">Псевдонимов нет.</p> : null}
              </div>
            </section>

            <section className="panel">
              <h2>Связи ({detail.edges.length})</h2>
              <div className="timeline">
                {detail.edges.map((edge) => (
                  <article className="item" key={edge.id}>
                    <div className="meta">
                      <span className="badge state">{edge.edgeType}</span>
                      <span>{edge.direction === 'inbound' ? 'входящая' : 'исходящая'}</span>
                      <span>{confidenceLabel(edge.confidence)}</span>
                    </div>
                    <h3>
                      {edge.neighbor ? (
                        <Link to={`/entities/${edge.neighbor.id}`}>
                          {edge.neighbor.canonicalName}
                        </Link>
                      ) : 'Связанная сущность'}
                    </h3>
                    <p>Доказательство: {edge.sourceRef}</p>
                    {edge.memoryId ? (
                      <p><Link to={`/memories/${edge.memoryId}`}>Открыть память-источник</Link></p>
                    ) : null}
                  </article>
                ))}
                {detail.edges.length === 0 ? <p className="hint">Связей нет.</p> : null}
              </div>
            </section>

            <section className="panel">
              <h2>Связанная память ({detail.memories.length})</h2>
              <div className="timeline">
                {detail.memories.map((memory) => (
                  <article className="item" key={memory.id}>
                    <div className="meta">
                      <span className="badge decision">{memory.memoryType}</span>
                      <span>{memory.status}</span>
                      {memory.role ? <span>роль: {memory.role}</span> : null}
                    </div>
                    <h3><Link to={`/memories/${memory.id}`}>{memory.title}</Link></h3>
                    {memory.content ? <p>{memory.content}</p> : null}
                    {memory.sourceRef ? <p>Доказательство: {memory.sourceRef}</p> : null}
                  </article>
                ))}
                {detail.memories.length === 0 ? <p className="hint">Связанной памяти нет.</p> : null}
              </div>
            </section>
          </>
        ) : null}

        {traversal ? (
          <section className="panel">
            <h2>Окружение графа</h2>
            <p className="hint">
              {traversal.trace.visitedNodeCount} сущностей · {traversal.trace.traversedEdgeCount}{' '}
              связей · остановка: {traversal.trace.stoppedReason} · доказательства обязательны
            </p>
            <div className="timeline">
              {traversal.nodes.map((node) => (
                <article className="item" key={node.id}>
                  <div className="meta">
                    <span className="badge state">{node.entityClass}</span>
                    <span>глубина {node.depth ?? 0}</span>
                  </div>
                  <h3><Link to={`/entities/${node.id}`}>{node.canonicalName}</Link></h3>
                  <p>{node.sourceRef}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    );
  }

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Граф знаний</p>
        <h1>Сущности и связи</h1>
        <p className="lede">
          Найдите сущность внутри {scopeLabel} и откройте её связи вместе с доказательствами.
        </p>
      </header>

      {scopePanel}

      <section className="panel">
        <h2>Поиск сущностей</h2>
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            void searchEntities();
          }}
        >
          <label>
            Имя, псевдоним или стабильный ID
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Например: Slice 01"
            />
          </label>
          <div className="actions">
            <button type="submit" disabled={loading || !backendResolved || !projectId}>
              Найти в графе
            </button>
          </div>
        </form>
        {!projectId ? <p className="hint">Для графа нужно выбрать конкретный проект.</p> : null}
        {error ? <div className="banner banner--warn" role="alert">{error}</div> : null}
      </section>

      <section className="panel">
        <h2>Результаты ({searchResult?.count ?? 0})</h2>
        <div className="timeline">
          {searchResult?.entities.map((entity) => (
            <article className="item" key={entity.id}>
              <div className="meta">
                <span className="badge state">{entity.entityClass}</span>
                <span>{confidenceLabel(entity.confidence)}</span>
                <span>{entity.memoryCount ?? 0} записей памяти</span>
              </div>
              <h3><Link to={`/entities/${entity.id}`}>{entity.canonicalName}</Link></h3>
              <p>{entity.aliases?.map((alias) => alias.alias).join(' · ') || entity.stableId}</p>
            </article>
          ))}
          {searchResult && searchResult.entities.length === 0 ? (
            <p className="hint">Совпадений в выбранном проекте нет.</p>
          ) : null}
          {!searchResult ? <p className="hint">Введите запрос или оставьте поле пустым для списка.</p> : null}
        </div>
      </section>
    </section>
  );
}
