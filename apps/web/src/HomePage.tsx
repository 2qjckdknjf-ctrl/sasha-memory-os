import { Link } from 'react-router-dom';
import {
  PROJECT_ID,
  PROJECT_NAME,
  type ConnectionRecord,
  type StateSummary,
  type TimelineEntry,
} from './controlCenter';
import { Timeline } from './Timeline';

type Props = {
  stateSummary: StateSummary | null;
  timeline: TimelineEntry[];
  reviewQueueCount: number;
  reviewQueueLoading: boolean;
  connectionWarnings: ConnectionRecord[];
};

export function HomePage({
  stateSummary,
  timeline,
  reviewQueueCount,
  reviewQueueLoading,
  connectionWarnings,
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
        <Link to="/search" className="button-link">
          Search
        </Link>
        <Link to={`/projects/${PROJECT_ID}`} className="button-link button-link--secondary">
          Open project
        </Link>
        <Link
          to={`/projects/${PROJECT_ID}#review-queue`}
          className="button-link button-link--secondary"
        >
          Review queue
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
      </div>

      <section className="panel">
        <h2>Последние события</h2>
        <Timeline entries={timeline.slice(0, 8)} emptyMessage="Пока нет записей в ленте." />
      </section>
    </section>
  );
}
