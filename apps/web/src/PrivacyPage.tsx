import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from './api';
import {
  ACTOR_LABELS,
  WORKSPACE_ID,
  formatTimestamp,
  type Actor,
  type BackendMode,
  type PrivacyRequestRecord,
} from './controlCenter';

type Props = {
  actor: Actor;
  backend: BackendMode;
  backendResolved: boolean;
  onExportMemories: () => void | Promise<void>;
  projectId: string | null;
  subjectId: string;
};

function describeAvailability(enabled: boolean): string {
  return enabled ? 'Доступно' : 'Недоступно';
}

function describeRequestType(
  value: PrivacyRequestRecord['requestType'],
): string {
  switch (value) {
    case 'deletion':
      return 'Удаление / forget';
    case 'correction':
      return 'Корректировка';
    case 'retraction':
      return 'Отзыв / retraction';
    default: {
      const exhaustiveCheck: never = value;
      return exhaustiveCheck;
    }
  }
}

export function PrivacyPage({
  actor,
  backend,
  backendResolved,
  onExportMemories,
  projectId,
  subjectId,
}: Props) {
  const isOwner = actor === 'owner';
  const exportAvailable = isOwner && backend !== 'local' && Boolean(projectId);
  const requestAvailable = isOwner && backend !== 'local' && Boolean(projectId);
  const [requests, setRequests] = useState<PrivacyRequestRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestType, setRequestType] =
    useState<PrivacyRequestRecord['requestType']>('deletion');
  const [targetMemoryId, setTargetMemoryId] = useState('');
  const [reason, setReason] = useState('');
  const [correctionText, setCorrectionText] = useState('');

  let exportHint = 'Экспорт использует существующий endpoint GET /v1/export/memories.';
  if (!isOwner) {
    exportHint =
      'Экспорт доступен только владельцу. Переключение акторов для demo по-прежнему остаётся на /ops.';
  } else if (!projectId) {
    exportHint =
      'Экспорт и privacy requests требуют явный project scope. Выберите проект; глобальная страница не должна default to AISTROYKA.';
  } else if (backend === 'local') {
    exportHint =
      'Экспорт требует подключенный API backend. В локальном preview страница не притворяется, что выгрузка сработает.';
  }

  useEffect(() => {
    let cancelled = false;

    async function loadRequests() {
      if (!backendResolved || !requestAvailable) {
        setRequests([]);
        setLoading(false);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await apiGet<{ requests?: PrivacyRequestRecord[] }>(
          `/v1/privacy/requests?workspace_id=${WORKSPACE_ID}&limit=50`,
          subjectId,
          actor,
        );
        if (!cancelled) {
          setRequests(result.requests ?? []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setRequests([]);
          setError((loadError as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadRequests();
    return () => {
      cancelled = true;
    };
  }, [actor, backendResolved, requestAvailable, subjectId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestAvailable) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiPost<PrivacyRequestRecord>(
        '/v1/privacy/requests',
        subjectId,
        {
          workspace_id: WORKSPACE_ID,
          project_id: projectId ?? undefined,
          actor_subject_id: subjectId,
          request_type: requestType,
          target_memory_id: targetMemoryId.trim() || undefined,
          reason,
          correction_text:
            requestType === 'correction' ? correctionText.trim() || undefined : undefined,
          idempotency_key: `privacy/${requestType}/${Date.now()}`,
        },
        actor,
      );
      setRequests((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setReason('');
      setTargetMemoryId('');
      setCorrectionText('');
      setRequestType('deletion');
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Приватность</p>
        <h1>Экспорт, удаление и корректировка памяти</h1>
        <p className="lede">
          Экран показывает только реальные privacy flows текущего билда: существующий экспорт и
          честные ограничения там, где API ещё нет.
        </p>
      </header>

      <div className="cta-row">
        <Link to="/audit" className="button-link button-link--secondary">
          Открыть аудит
        </Link>
        <Link to="/transferred-objects" className="button-link button-link--secondary">
          Apple transferred objects
        </Link>
        <Link to="/conflicts" className="button-link button-link--secondary">
          Открыть конфликты
        </Link>
        <Link to="/search" className="button-link button-link--secondary">
          Найти запись
        </Link>
      </div>

      <section className="panel">
        <h2>Экспорт данных владельца</h2>
        <div className="stat-grid">
          <article className="stat-card">
            <span className="stat-card__label">Экспорт API</span>
            <strong>{describeAvailability(backend !== 'local')}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-card__label">Текущий актор</span>
            <strong>{ACTOR_LABELS[actor]}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-card__label">Право на выгрузку</span>
            <strong>{describeAvailability(exportAvailable)}</strong>
          </article>
        </div>
        <p className="hint" id="privacy-export-hint">
          {exportHint}
        </p>
        <p className="hint">
          Для Apple companion Slice 05 фактический project-scoped tombstone delete находится на
          странице Apple transferred objects; этот экран по-прежнему отвечает за privacy requests и
          экспорт.
        </p>
        <div className="actions">
          <button
            type="button"
            disabled={!exportAvailable}
            aria-describedby="privacy-export-hint"
            onClick={() => {
              void onExportMemories();
            }}
          >
            Скачать JSON-экспорт памяти
          </button>
        </div>
      </section>

      <div className="grid surface-grid">
        <section className="panel">
          <h2>Запрос на удаление / forget</h2>
          <p className="hint">
            Этот экран создает реальные privacy requests в backend и показывает уже сохраненные
            обращения владельца. Он не делает скрытого удаления только в UI.
          </p>
          <form className="form" onSubmit={(event) => void handleSubmit(event)}>
            <label>
              Тип запроса
              <select
                value={requestType}
                disabled={!requestAvailable || submitting}
                onChange={(event) =>
                  setRequestType(event.target.value as PrivacyRequestRecord['requestType'])
                }
              >
                <option value="deletion">Удаление / forget</option>
                <option value="correction">Корректировка</option>
                <option value="retraction">Отзыв / retraction</option>
              </select>
            </label>
            <label>
              ID записи памяти
              <input
                value={targetMemoryId}
                disabled={!requestAvailable || submitting}
                onChange={(event) => setTargetMemoryId(event.target.value)}
                placeholder="Опционально: UUID записи"
              />
            </label>
            <label>
              Причина
              <textarea
                rows={3}
                value={reason}
                disabled={!requestAvailable || submitting}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Что нужно удалить, исправить или отозвать"
              />
            </label>
            {requestType === 'correction' ? (
              <label>
                Текст корректировки
                <textarea
                  rows={3}
                  value={correctionText}
                  disabled={!requestAvailable || submitting}
                  onChange={(event) => setCorrectionText(event.target.value)}
                  placeholder="Как должна выглядеть исправленная запись"
                />
              </label>
            ) : null}
            <div className="actions">
              <button
                type="submit"
                disabled={!requestAvailable || submitting || reason.trim().length === 0}
              >
                {submitting ? 'Отправляю…' : 'Отправить privacy request'}
              </button>
              <Link to="/conflicts" className="button-link button-link--secondary">
                К очереди конфликтов
              </Link>
            </div>
          </form>
          {!backendResolved ? <p className="hint">Определяю режим backend…</p> : null}
          {backendResolved && !isOwner ? (
            <p className="hint">Отправка privacy requests доступна только владельцу.</p>
          ) : null}
          {backendResolved && isOwner && !projectId ? (
            <p className="hint">
              Сначала выберите проект. Export/delete/correction/retraction теперь требуют
              explicit `project_id` и не используют fallback project.
            </p>
          ) : null}
          {backendResolved && isOwner && backend === 'local' ? (
            <p className="hint">
              Для privacy requests нужен подключенный API backend. Локальный preview не притворяется,
              что запрос уже сохранен.
            </p>
          ) : null}
          {loading ? <p className="hint">Загружаю историю запросов…</p> : null}
          {error ? <p className="hint">Не удалось выполнить privacy flow: {error}</p> : null}
        </section>

        <section className="panel">
          <h2>История запросов владельца</h2>
          {requests.length === 0 && !loading ? (
            <p className="hint">Сохраненных privacy requests пока нет.</p>
          ) : (
            <ul className="surface-selector" aria-label="История privacy requests">
              {requests.map((request) => (
                <li key={request.id}>
                  <article className="surface-selector__button">
                    <span className="meta">
                      <span className="badge state">{request.status}</span>
                      <span>{formatTimestamp(request.createdAt)}</span>
                    </span>
                    <strong>{describeRequestType(request.requestType)}</strong>
                    <span className="hint">
                      {request.actor?.displayName ?? 'Owner'}
                      {request.targetMemoryId ? ` · memory ${request.targetMemoryId.slice(0, 8)}…` : ''}
                    </span>
                    <p>{request.reason}</p>
                    {request.correctionText ? (
                      <pre className="preformatted">{request.correctionText}</pre>
                    ) : null}
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
