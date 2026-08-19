import { type MemoryStore } from '@memory-os/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { apiGet } from './api';
import {
  PROJECT_ID,
  formatTimestamp,
  type Actor,
  type BackendMode,
  type MemoryDetail,
  type MemoryStatusAction,
} from './controlCenter';

type Props = {
  actor: Actor;
  backend: BackendMode;
  subjectId: string;
  localStore: MemoryStore;
  onSetMemoryStatus: (memoryId: string, status: MemoryStatusAction) => Promise<boolean>;
};

type MemoryDetailResponse = {
  memory: MemoryDetail;
  backend?: string;
};

type InspectorLocationState = {
  from?: 'search' | 'project' | 'timeline' | 'review';
  searchTerm?: string;
  projectId?: string | null;
};

type DisplayValueProps = {
  value: unknown;
};

type FactRow = {
  label: string;
  value: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(value);
}

function describeLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('404')) return 'Запись памяти не найдена.';
  if (message.includes('403')) return 'Нет доступа к этой записи памяти.';
  return `Не удалось загрузить запись памяти: ${message}`;
}

function extractSupplementaryField(memory: MemoryDetail, field: string): unknown {
  const direct = (memory as Record<string, unknown>)[field];
  if (direct !== undefined) return direct;
  const metadata = isRecord(memory.metadata) ? memory.metadata : null;
  return metadata?.[field];
}

function DisplayValue({ value }: DisplayValueProps) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <p>{String(value)}</p>;
  }
  return <pre className="preformatted">{JSON.stringify(value, null, 2)}</pre>;
}

export function MemoryInspectorPage({
  actor,
  backend,
  subjectId,
  localStore,
  onSetMemoryStatus,
}: Props) {
  const { id: memoryId } = useParams<{ id: string }>();
  const location = useLocation();
  const navState = (location.state as InspectorLocationState | null) ?? null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [memory, setMemory] = useState<MemoryDetail | null>(null);
  const [detailBackend, setDetailBackend] = useState<string>(backend);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<MemoryStatusAction | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadMemory() {
      if (!memoryId) {
        setMemory(null);
        setLoadError('Идентификатор записи памяти не указан.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);

      try {
        if (backend === 'local') {
          const localMemory = localStore.memories.get(memoryId);
          if (!localMemory) {
            throw new Error('404 local memory not found');
          }
          if (!cancelled) {
            setMemory(localMemory);
            setDetailBackend('local');
          }
          return;
        }

        const result = await apiGet<MemoryDetailResponse>(`/v1/memories/${memoryId}`, subjectId, actor);
        if (!cancelled) {
          setMemory(result.memory);
          setDetailBackend(result.backend ?? backend);
        }
      } catch (error) {
        if (!cancelled) {
          setMemory(null);
          setLoadError(describeLoadError(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadMemory();
    return () => {
      cancelled = true;
    };
  }, [actor, backend, localStore, memoryId, reloadToken, subjectId]);

  useEffect(() => {
    if (memory) {
      headingRef.current?.focus();
    }
  }, [memory]);

  const memoryType = memory?.memoryType ?? memory?.type ?? 'unknown';
  const sourceValue = useMemo(
    () => (memory ? extractSupplementaryField(memory, 'source') : undefined),
    [memory],
  );
  const evidenceValue = useMemo(
    () => (memory ? extractSupplementaryField(memory, 'evidence') : undefined),
    [memory],
  );
  const provenanceValue = useMemo(
    () => (memory ? extractSupplementaryField(memory, 'provenance') : undefined),
    [memory],
  );

  const metadata = useMemo(() => {
    if (!memory || !isRecord(memory.metadata)) return null;
    const next = { ...memory.metadata };
    delete next.source;
    delete next.evidence;
    delete next.provenance;
    return Object.keys(next).length > 0 ? next : null;
  }, [memory]);

  const factRows = useMemo<FactRow[]>(() => {
    if (!memory) return [];
    const rows: Array<FactRow | null> = [
      { label: 'Тип', value: memoryType },
      { label: 'Статус', value: memory.status },
      { label: 'Источник данных', value: detailBackend },
      memory.sensitivity ? { label: 'Чувствительность', value: memory.sensitivity } : null,
      memory.projectId ? { label: 'Проект', value: memory.projectId } : null,
      memory.workspaceId ? { label: 'Рабочее пространство', value: memory.workspaceId } : null,
      memory.sourceEventId ? { label: 'ID source event', value: memory.sourceEventId } : null,
      memory.createdBySubject
        ? { label: 'Создано субъектом', value: memory.createdBySubject }
        : null,
      memory.supersededBy ? { label: 'Замещено записью', value: memory.supersededBy } : null,
      typeof memory.importance === 'number'
        ? { label: 'Важность', value: memory.importance.toFixed(2) }
        : null,
      typeof memory.confidence === 'number'
        ? { label: 'Уверенность', value: memory.confidence.toFixed(2) }
        : null,
    ];
    return rows.filter((row): row is FactRow => row !== null);
  }, [detailBackend, memory, memoryType]);

  const timestampRows = useMemo<FactRow[]>(() => {
    if (!memory) return [];
    const rows: Array<FactRow | null> = [
      memory.recordedAt ? { label: 'Записано', value: formatTimestamp(memory.recordedAt) } : null,
      memory.observedAt ? { label: 'Наблюдалось', value: formatTimestamp(memory.observedAt) } : null,
      memory.validFrom ? { label: 'Действует с', value: formatTimestamp(memory.validFrom) } : null,
      memory.validTo ? { label: 'Действует до', value: formatTimestamp(memory.validTo) } : null,
    ];
    return rows.filter((row): row is FactRow => row !== null);
  }, [memory]);

  const projectLink = memory?.projectId ?? navState?.projectId ?? PROJECT_ID;
  const searchLabel = navState?.searchTerm ? `К поиску «${navState.searchTerm}»` : 'К поиску';

  async function handleStatusChange(status: MemoryStatusAction) {
    if (!memoryId) return;
    setPendingStatus(status);
    const ok = await onSetMemoryStatus(memoryId, status);
    setPendingStatus(null);
    if (ok) {
      setReloadToken((value) => value + 1);
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Inspector памяти</p>
        <div className="cta-row">
          <Link to="/search" className="button-link button-link--secondary">
            {searchLabel}
          </Link>
          <Link to="/" className="button-link button-link--secondary">
            На главную
          </Link>
          <Link to={`/projects/${projectLink}`} className="button-link button-link--secondary">
            К проекту
          </Link>
        </div>
        <h1 ref={headingRef} tabIndex={-1}>
          {memory?.title ?? 'Запись памяти'}
        </h1>
        <p className="lede">
          Полная запись, статус и дополнительные поля из API без выдуманных данных.
        </p>
      </header>

      {loading ? (
        <section className="panel">
          <h2>Загрузка</h2>
          <p className="hint">Загружаю запись памяти…</p>
        </section>
      ) : null}

      {!loading && loadError ? (
        <section className="panel">
          <h2>Запись недоступна</h2>
          <p>{loadError}</p>
          {memoryId ? <p className="hint">ID: {memoryId}</p> : null}
        </section>
      ) : null}

      {!loading && !loadError && memory ? (
        <>
          <div className="grid">
            <section className="panel">
              <h2>Запись</h2>
              <div className="meta">
                <span className="badge decision">{memoryType}</span>
                <span className="badge state">{memory.status}</span>
                {memory.recordedAt ? <span>{formatTimestamp(memory.recordedAt)}</span> : null}
              </div>
              <pre className="preformatted memory-inspector__body">{memory.content}</pre>
            </section>

            <section className="panel">
              <h2>Статус и реквизиты</h2>
              <dl className="memory-inspector__facts">
                {factRows.map((row) => (
                  <div key={row.label} className="memory-inspector__fact">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="actions">
                {actor === 'owner' ? (
                  <>
                    <button
                      type="button"
                      disabled={pendingStatus !== null || memory.status === 'verified'}
                      onClick={() => {
                        void handleStatusChange('verified');
                      }}
                    >
                      Подтвердить
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={pendingStatus !== null || memory.status === 'disputed'}
                      onClick={() => {
                        void handleStatusChange('disputed');
                      }}
                    >
                      Оспорить
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={pendingStatus !== null || memory.status === 'retracted'}
                      onClick={() => {
                        void handleStatusChange('retracted');
                      }}
                    >
                      Отозвать
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={pendingStatus !== null || memory.status === 'disputed'}
                    onClick={() => {
                      void handleStatusChange('disputed');
                    }}
                  >
                    Оспорить
                  </button>
                )}
              </div>

              {pendingStatus ? (
                <p className="hint">Обновляю статус: {pendingStatus}…</p>
              ) : actor !== 'owner' ? (
                <p className="hint">
                  Для не-owner в API разрешено только действие «оспорить».
                </p>
              ) : null}
            </section>
          </div>

          {timestampRows.length > 0 ? (
            <section className="panel">
              <h2>Временные метки</h2>
              <dl className="memory-inspector__facts">
                {timestampRows.map((row) => (
                  <div key={row.label} className="memory-inspector__fact">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {sourceValue !== undefined ? (
            <section className="panel">
              <h2>Источник</h2>
              <DisplayValue value={sourceValue} />
            </section>
          ) : null}

          {evidenceValue !== undefined ? (
            <section className="panel">
              <h2>Доказательства</h2>
              <DisplayValue value={evidenceValue} />
            </section>
          ) : null}

          {provenanceValue !== undefined ? (
            <section className="panel">
              <h2>Происхождение</h2>
              <DisplayValue value={provenanceValue} />
            </section>
          ) : null}

          {metadata ? (
            <section className="panel">
              <h2>Метаданные API</h2>
              <pre className="preformatted">{JSON.stringify(metadata, null, 2)}</pre>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
