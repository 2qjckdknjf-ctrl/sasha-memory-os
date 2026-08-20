import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from './api';
import {
  describeMemoryStatus,
  formatTimestamp,
  WORKSPACE_ID,
  type Actor,
  type BackendMode,
  type TransferredObjectRecord,
} from './controlCenter';
import { buildTransferredObjectsPath } from './projectScope';

type Props = {
  actor: Actor;
  backend: BackendMode;
  backendResolved: boolean;
  subjectId: string;
  projectId: string | null;
  projectName: string | null;
  scopeLabel: string;
  scopePanel: ReactNode;
};

type TransferredObjectsResponse = {
  objects?: TransferredObjectRecord[];
  backend?: string;
};

function describeSource(source: TransferredObjectRecord['source']): string {
  switch (source) {
    case 'companion_app':
      return 'Companion app';
    case 'share_extension':
      return 'Share Extension';
    case 'document_picker':
      return 'Files-selected';
    case 'photo_library':
      return 'PhotoKit-selected';
    default: {
      const exhaustiveCheck: never = source;
      return exhaustiveCheck;
    }
  }
}

function describeKind(kind: TransferredObjectRecord['kind']): string {
  switch (kind) {
    case 'text':
      return 'Text';
    case 'file':
      return 'File';
    case 'photo':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'url':
      return 'URL';
    default: {
      const exhaustiveCheck: never = kind;
      return exhaustiveCheck;
    }
  }
}

export function TransferredObjectsPage({
  actor,
  backend,
  backendResolved,
  subjectId,
  projectId,
  projectName,
  scopeLabel,
  scopePanel,
}: Props) {
  const [objects, setObjects] = useState<TransferredObjectRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTransferredObjects() {
      if (!backendResolved) {
        setLoading(true);
        setError(null);
        return;
      }
      if (!projectId) {
        setObjects([]);
        setLoading(false);
        setError(null);
        return;
      }
      if (backend === 'local') {
        setObjects([]);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const result = await apiGet<TransferredObjectsResponse>(
          buildTransferredObjectsPath({
            workspaceId: WORKSPACE_ID,
            projectId,
            limit: 100,
          }),
          subjectId,
          actor,
        );
        if (!cancelled) {
          setObjects(result.objects ?? []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setObjects([]);
          setError((loadError as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadTransferredObjects();
    return () => {
      cancelled = true;
    };
  }, [actor, backend, backendResolved, projectId, subjectId]);

  async function handleDelete(object: TransferredObjectRecord) {
    if (actor !== 'owner' || backend === 'local' || !projectId) {
      return;
    }
    setPendingDeleteId(object.id);
    setError(null);
    try {
      await apiPost(
        `/v1/apple/transferred-objects/${object.id}/delete`,
        subjectId,
        {
          project_id: projectId,
          actor_subject_id: subjectId,
          reason: 'Owner requested deletion of an Apple-transferred object from Control Center.',
        },
        actor,
      );
      setObjects((current) => current.filter((item) => item.id !== object.id));
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setPendingDeleteId(null);
    }
  }

  const deleteAvailable = actor === 'owner' && backend !== 'local' && Boolean(projectId);

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Apple companion</p>
        <h1>Transferred objects</h1>
        <p className="lede">
          Project-scoped list of Apple-transferred objects already captured into Memory OS. Delete
          uses the existing memory tombstone path and never defaults to AISTROYKA.
        </p>
      </header>

      <div className="cta-row">
        <Link to="/privacy" className="button-link button-link--secondary">
          К приватности
        </Link>
        {projectId ? (
          <Link to={`/projects/${projectId}`} className="button-link button-link--secondary">
            К проекту
          </Link>
        ) : null}
      </div>

      <section className="panel">
        <h2>Scope</h2>
        <p className="hint">Текущий scope: {scopeLabel}</p>
        {scopePanel}
      </section>

      {!backendResolved ? (
        <section className="panel">
          <h2>Загрузка</h2>
          <p className="hint">Определяю backend и project scope…</p>
        </section>
      ) : null}

      {backendResolved && !projectId ? (
        <section className="panel">
          <h2>Нужен явный проект</h2>
          <p>
            Выберите проект в каталоге или откройте карточку проекта. Этот список никогда не
            сваливается в AISTROYKA по умолчанию.
          </p>
        </section>
      ) : null}

      {backendResolved && backend === 'local' ? (
        <section className="panel">
          <h2>API backend required</h2>
          <p className="hint">
            Локальный preview не подделывает Apple-transferred objects. Подключите API backend,
            чтобы увидеть реальный project-scoped список и tombstone delete.
          </p>
        </section>
      ) : null}

      {projectId && backend !== 'local' ? (
        <section className="panel">
          <h2>Objects for {projectName ?? projectId}</h2>
          <p className="hint">
            Источник может быть Share Extension, companion app, PhotoKit-selected или
            Files-selected. После tombstone delete объект пропадает из этого списка.
          </p>
          {actor !== 'owner' ? (
            <p className="hint">
              Удаление доступно только owner; остальные акторы могут открыть объект в Inspector.
            </p>
          ) : null}
          {loading ? <p className="hint">Загружаю transferred objects…</p> : null}
          {error ? <p className="hint">Не удалось загрузить или удалить объект: {error}</p> : null}
          {!loading && objects.length === 0 && !error ? (
            <p className="hint">Для выбранного проекта Apple-transferred objects пока не найдены.</p>
          ) : (
            <ul className="surface-selector" aria-label="Apple transferred objects">
              {objects.map((object) => (
                <li key={object.id}>
                  <article className="surface-selector__button">
                    <span className="meta">
                      <span className="badge state">{describeMemoryStatus(object.status)}</span>
                      <span>{formatTimestamp(object.recorded_at)}</span>
                    </span>
                    <strong>{object.title}</strong>
                    <span className="hint">
                      {describeSource(object.source)} · {describeKind(object.kind)}
                      {object.memory_type ? ` · ${object.memory_type}` : ''}
                      {object.device_id ? ` · ${object.device_id}` : ''}
                    </span>
                    {object.filename ? <p>File: {object.filename}</p> : null}
                    {object.canonical_reference ? (
                      <p className="hint">{object.canonical_reference}</p>
                    ) : null}
                    <div className="actions">
                      <Link
                        to={`/memories/${object.id}`}
                        state={{ from: 'project', projectId: object.project_id }}
                        className="button-link button-link--secondary"
                      >
                        Открыть в Inspector
                      </Link>
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={!deleteAvailable || pendingDeleteId === object.id}
                        onClick={() => {
                          void handleDelete(object);
                        }}
                      >
                        {pendingDeleteId === object.id ? 'Удаляю…' : 'Удалить из Memory OS'}
                      </button>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </section>
  );
}
