import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ReviewQueueList } from './ReviewQueueList';
import {
  type Actor,
  type BackendMode,
  type ReviewQueueItem,
} from './controlCenter';

type Props = {
  actor: Actor;
  backend: BackendMode;
  scopeLabel: string;
  scopePanel: ReactNode;
  reviewQueue: ReviewQueueItem[];
  reviewQueueLoading: boolean;
  onSetReviewStatus: (
    memoryId: string,
    status: 'verified' | 'disputed' | 'retracted',
  ) => void | Promise<boolean>;
  onRunConsolidation: () => void | Promise<void>;
};

export function ConflictsPage({
  actor,
  backend,
  scopeLabel,
  scopePanel,
  reviewQueue,
  reviewQueueLoading,
  onSetReviewStatus,
  onRunConsolidation,
}: Props) {
  const candidateCount = reviewQueue.filter((item) => item.status === 'candidate').length;
  const disputedCount = reviewQueue.filter((item) => item.status === 'disputed').length;
  const totalCount = reviewQueue.length;
  const canRunConsolidation = actor === 'owner' && backend !== 'local';

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Конфликты</p>
        <div className="cta-row">
          <Link to="/projects" className="button-link button-link--secondary">
            Каталог проектов
          </Link>
          <Link to="/search" className="button-link button-link--secondary">
            К поиску
          </Link>
        </div>
        <h1>Конфликты и спорные записи</h1>
        <p className="lede">
          Отдельная очередь для владельца: кандидаты на проверку, спорные записи и доступный
          маршрут исправления дублей по {scopeLabel} без перехода в ops-панель.
        </p>
      </header>

      {scopePanel}

      <div className="grid grid--home">
        <section className="panel">
          <h2>Нужно внимание по {scopeLabel}</h2>
          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-card__label">Всего элементов</span>
              <strong>{totalCount}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-card__label">Спорные записи</span>
              <strong>{disputedCount}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-card__label">Кандидаты на проверку</span>
              <strong>{candidateCount}</strong>
            </div>
          </div>
        </section>

        <section className="panel">
          <h2>Исправление и supersede</h2>
          <p>
            Прямого owner-действия «исправить запись» в текущем API нет. Доступный путь
            исправления — существующая консолидация кандидатов, которая помечает дубликаты как
            <code>superseded</code> через backend.
          </p>
          <div className="actions">
            <button
              type="button"
              disabled={!canRunConsolidation}
              onClick={() => {
                void onRunConsolidation();
              }}
            >
              Запустить консолидацию кандидатов
            </button>
          </div>
          {actor !== 'owner' ? (
            <p className="hint">
              Консолидация и прямые действия подтверждения/отзыва доступны только владельцу.
            </p>
          ) : backend === 'local' ? (
            <p className="hint">Консолидация доступна только при подключенном API backend.</p>
          ) : (
            <p className="hint">
              Кнопка использует существующий backend flow без новых endpoint и без ручного reason.
            </p>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Очередь конфликтов</h2>
        {reviewQueueLoading && reviewQueue.length > 0 ? (
          <p className="hint">Обновляю элементы, требующие решения…</p>
        ) : null}
        <ReviewQueueList
          actor={actor}
          items={reviewQueue}
          source="conflicts"
          emptyMessage={
            reviewQueueLoading
              ? 'Загружаю элементы, требующие решения…'
              : 'Сейчас нет кандидатов или спорных записей.'
          }
          onSetStatus={onSetReviewStatus}
        />
      </section>
    </section>
  );
}
