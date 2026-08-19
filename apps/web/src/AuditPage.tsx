import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from './api';
import { buildAuditPath } from './projectScope';
import {
  WORKSPACE_ID,
  formatTimestamp,
  type Actor,
  type AuditEventRecord,
  type BackendMode,
} from './controlCenter';

type Props = {
  actor: Actor;
  backend: BackendMode;
  backendResolved: boolean;
  subjectId: string;
};

function describeBackendMode(backend: BackendMode): string {
  switch (backend) {
    case 'local':
      return 'Локальный preview';
    case 'memory-store':
    case 'supabase':
      return 'Подключенный API backend';
    default: {
      const exhaustiveCheck: never = backend;
      return exhaustiveCheck;
    }
  }
}

function describeAuditAction(action: string): string {
  switch (action) {
    case 'memory.set_status':
      return 'Изменение статуса памяти';
    case 'memory.correct':
      return 'Исправление памяти';
    case 'handoff.create':
      return 'Создание хэнд-оффа';
    case 'privacy.request.submitted':
      return 'Запрос приватности';
    case 'memory.export':
      return 'Экспорт памяти';
    case 'connection.sync.requested':
      return 'Запуск sync подключения';
    case 'connection.sync.completed':
      return 'Завершение sync подключения';
    case 'memory.supersede':
      return 'Замещение памяти';
    default:
      return action;
  }
}

function describeActor(event: AuditEventRecord): string {
  return (
    event.actor?.displayName ??
    event.actor?.externalKey ??
    event.actorSubjectId?.slice(0, 8) ??
    'Неизвестный актор'
  );
}

export function AuditPage({ actor, backend, backendResolved, subjectId }: Props) {
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAudit() {
      if (!backendResolved || backend === 'local') {
        setEvents([]);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const result = await apiGet<{ events?: AuditEventRecord[] }>(
          buildAuditPath({ workspaceId: WORKSPACE_ID, limit: 50 }),
          subjectId,
          actor,
        );
        if (!cancelled) {
          setEvents(result.events ?? []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError((loadError as Error).message);
          setEvents([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadAudit();
    return () => {
      cancelled = true;
    };
  }, [actor, backend, backendResolved, subjectId]);

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Аудит</p>
        <h1>Аудит действий и событий</h1>
        <p className="lede">
          Лента ниже показывает только реальные события из backend: изменение статусов памяти,
          хэнд-оффы, privacy requests, экспорт и connector sync.
        </p>
      </header>

      <div className="cta-row">
        <Link to="/privacy" className="button-link">
          Открыть приватность
        </Link>
        <Link to="/" className="button-link button-link--secondary">
          На главную
        </Link>
        <Link to="/conflicts" className="button-link button-link--secondary">
          К конфликтам
        </Link>
      </div>

      <div className="grid surface-grid">
        <section className="panel">
          <h2>Лента аудита</h2>
          <div className="stat-grid">
            <article className="stat-card">
              <span className="stat-card__label">Текущий режим</span>
              <strong>{describeBackendMode(backend)}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-card__label">Событий загружено</span>
              <strong>{events.length}</strong>
            </article>
          </div>

          {!backendResolved ? <p className="hint">Определяю режим backend…</p> : null}
          {backendResolved && backend === 'local' ? (
            <p className="hint">
              Для аудита нужен запущенный API backend на <code>:8787</code>. Локальный preview без
              API не придумывает строки журнала.
            </p>
          ) : null}
          {loading ? <p className="hint">Загружаю аудит…</p> : null}
          {error ? <p className="hint">Не удалось загрузить аудит: {error}</p> : null}
          {!loading && !error && backend !== 'local' && events.length === 0 ? (
            <p className="hint">
              Backend вернул пустую ленту. После изменения статуса памяти, хэнд-оффа или privacy
              request здесь появятся реальные записи.
            </p>
          ) : null}
          {!loading && !error && events.length > 0 ? (
            <ul className="surface-selector" aria-label="Лента аудита">
              {events.map((event) => (
                <li key={event.id}>
                  <article className="surface-selector__button">
                    <span className="meta">
                      <span className="badge state">{event.objectType ?? 'event'}</span>
                      <span>{formatTimestamp(event.recordedAt)}</span>
                    </span>
                    <strong>{describeAuditAction(event.action)}</strong>
                    <span className="hint">
                      {describeActor(event)}
                      {event.reason ? ` · ${event.reason}` : ''}
                    </span>
                    {event.afterState ? (
                      <pre className="preformatted">{JSON.stringify(event.afterState, null, 2)}</pre>
                    ) : null}
                  </article>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="panel">
          <h2>Что доступно уже сейчас</h2>
          <ul className="surface-bullets">
            <li>
              После review-действий в Inspector события появляются здесь через тот же backend, а не
              только на главной.
            </li>
            <li>
              <Link to="/privacy">Приватность</Link> теперь добавляет сюда owner requests на
              удаление, correction и retraction.
            </li>
            <li>
              <Link to="/handoffs">Хэнд-оффы</Link> и <Link to="/connections">подключения</Link>{' '}
              тоже оставляют реальные audit events.
            </li>
          </ul>
        </section>
      </div>
    </section>
  );
}
