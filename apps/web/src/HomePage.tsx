import { Link } from 'react-router-dom';
import {
  PROJECT_ID,
  PROJECT_NAME,
  type ConnectionRecord,
  type StateSummary,
  type TimelineEntry,
} from './controlCenter';
import { describeHandoffActors, type HandoffSurfaceItem, type TaskSurfaceItem } from './surfaces';
import { Timeline } from './Timeline';

type Props = {
  stateSummary: StateSummary | null;
  timeline: TimelineEntry[];
  reviewQueueCount: number;
  reviewQueueLoading: boolean;
  connectionWarnings: ConnectionRecord[];
  taskPreview: TaskSurfaceItem | null;
  lastHandoff: HandoffSurfaceItem | null;
};

export function HomePage({
  stateSummary,
  timeline,
  reviewQueueCount,
  reviewQueueLoading,
  connectionWarnings,
  taskPreview,
  lastHandoff,
}: Props) {
  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Главная</p>
        <h1>Память проекта под рукой</h1>
        <p className="lede">
          Быстрый обзор по проекту {PROJECT_NAME}: состояние, свежие события, очередь на
          проверку и ошибки синхронизации.
        </p>
      </header>

      <div className="cta-row">
        <Link to="/tasks" className="button-link">
          Задачи
        </Link>
        <Link to="/handoffs" className="button-link button-link--secondary">
          Хэнд-оффы
        </Link>
        <Link to="/search" className="button-link">
          Поиск
        </Link>
        <Link to={`/projects/${PROJECT_ID}`} className="button-link button-link--secondary">
          Открыть проект
        </Link>
        <Link to="/conflicts" className="button-link button-link--secondary">
          Разобрать очередь
        </Link>
      </div>

      <div className="grid grid--home">
        <section className="panel">
          <h2>Проект {PROJECT_NAME}</h2>
          {stateSummary ? (
            <div className="stat-grid">
              <div className="stat-card">
                <span className="stat-card__label">Stage</span>
                <strong>{stateSummary.stage}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">Next</span>
                <strong>{stateSummary.next}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">Active decisions</span>
                <strong>{stateSummary.active}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">Completed</span>
                <strong>{stateSummary.completed}</strong>
              </div>
            </div>
          ) : (
            <p className="hint">Состояние проекта еще не загружено.</p>
          )}
        </section>

        <section className="panel">
          <h2>Очередь на проверку</h2>
          <p className="hint">Кандидаты и спорные записи, которые ждут решения владельца.</p>
          {reviewQueueLoading ? (
            <p className="hint">Загружаю кандидаты на проверку…</p>
          ) : (
            <div className="stat-grid stat-grid--compact">
              <div className="stat-card">
                <span className="stat-card__label">Нужно проверить</span>
                <strong>{reviewQueueCount}</strong>
              </div>
            </div>
          )}

          {connectionWarnings.length > 0 ? (
            <>
              <h3 className="section-subtitle">Нужны действия по синхронизации</h3>
              <ul className="warning-list">
                {connectionWarnings.map((warning, index) => (
                  <li key={warning.id ?? `${warning.connectorId}-${index}`}>
                    <strong>{warning.displayName ?? warning.connectorId ?? 'Connection'}</strong>
                    <span>
                      {warning.status === 'reauth_required'
                        ? 'Требуется повторная авторизация.'
                        : warning.lastError ?? 'Есть ошибка синхронизации.'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="hint">Критичных ошибок синхронизации не найдено.</p>
          )}
        </section>

        <section className="panel">
          <h2>Следующий шаг и хэнд-офф</h2>
          <div className="surface-stack">
            <div>
              <p className="section-subtitle">Следующая задача</p>
              {taskPreview ? (
                <>
                  <strong>{taskPreview.title}</strong>
                  <p className="hint">{taskPreview.detail}</p>
                </>
              ) : (
                <p className="hint">Следующие задачи пока не выделены.</p>
              )}
            </div>

            <div>
              <p className="section-subtitle">Последний хэнд-офф</p>
              {lastHandoff ? (
                <>
                  <strong>{describeHandoffActors(lastHandoff)}</strong>
                  <p className="hint">{lastHandoff.summary}</p>
                </>
              ) : (
                <p className="hint">Хэнд-оффы еще не создавались.</p>
              )}
            </div>

            <div className="actions">
              <Link to="/tasks" className="button-link button-link--secondary">
                Открыть задачи
              </Link>
              <Link to="/handoffs" className="button-link button-link--secondary">
                Открыть хэнд-оффы
              </Link>
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <h2>Последние события</h2>
        <Timeline entries={timeline.slice(0, 8)} emptyMessage="Пока нет записей в ленте." />
      </section>
    </section>
  );
}
