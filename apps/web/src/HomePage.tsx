import type { ReactNode } from 'react';
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
  scopeLabel: string;
  scopePanel: ReactNode;
  stateSummary: StateSummary | null;
  timeline: TimelineEntry[];
  reviewQueueCount: number;
  reviewQueueLoading: boolean;
  connectionWarnings: ConnectionRecord[];
  taskPreview: TaskSurfaceItem | null;
  lastHandoff: HandoffSurfaceItem | null;
};

export function HomePage({
  scopeLabel,
  scopePanel,
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
        <h1>Память рабочей области под рукой</h1>
        <p className="lede">
          Быстрый обзор по {scopeLabel}: свежие события, очередь на проверку и ошибки
          синхронизации без неявной привязки к seed project.
        </p>
      </header>

      {scopePanel}

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
        <Link to="/connections" className="button-link button-link--secondary">
          Подключения
        </Link>
        <Link to="/projects" className="button-link button-link--secondary">
          Все проекты
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
          <h2>Состояние и фокус</h2>
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
            <p className="hint">
              Выберите проект в фильтре или откройте карточку проекта, чтобы увидеть его состояние.
            </p>
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
                    <strong>
                      <Link to="/connections">
                        {warning.displayName ?? warning.connectorId ?? 'Connection'}
                      </Link>
                    </strong>
                    <span>
                      {warning.status === 'reauth_required'
                        ? 'Требуется повторная авторизация.'
                        : warning.lastError ?? 'Есть ошибка синхронизации.'}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="actions">
                <Link to="/connections" className="button-link button-link--secondary">
                  Открыть подключения
                </Link>
              </div>
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
              <Link to={`/projects/${PROJECT_ID}`} className="button-link button-link--secondary">
                Shortcut: {PROJECT_NAME}
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
