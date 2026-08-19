import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ReviewQueueList } from './ReviewQueueList';
import {
  type Actor,
  PROJECT_ID,
  PROJECT_NAME,
  type StateSummary,
  type TimelineEntry,
  type ReviewQueueItem,
} from './controlCenter';
import { Timeline } from './Timeline';

type Props = {
  actor: Actor;
  stateSummary: StateSummary | null;
  timeline: TimelineEntry[];
  title: string;
  content: string;
  reviewQueue: ReviewQueueItem[];
  reviewQueueLoading: boolean;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onStoreDecision: () => void | Promise<void>;
  onCreateHandoff: () => void | Promise<void>;
  onSetReviewStatus: (
    memoryId: string,
    status: 'verified' | 'disputed' | 'retracted',
  ) => void | Promise<boolean>;
};

export function ProjectPage({
  actor,
  stateSummary,
  timeline,
  title,
  content,
  reviewQueue,
  reviewQueueLoading,
  onTitleChange,
  onContentChange,
  onStoreDecision,
  onCreateHandoff,
  onSetReviewStatus,
}: Props) {
  const params = useParams<{ id: string }>();
  const projectId = params.id ?? PROJECT_ID;
  const isSeedProject = projectId === PROJECT_ID;

  const latestTimeline = useMemo(() => timeline.slice(0, 10), [timeline]);

  if (!isSeedProject) {
    return (
      <section className="page">
        <header className="page-header">
          <p className="eyebrow">Проект</p>
          <h1>Карточка проекта</h1>
          <p className="lede">
            Проект уже есть в памяти, но в этом срезе детальная surface пока остаётся облегчённой.
            Полный multi-project workflow будет расширен дальше.
          </p>
        </header>

        <div className="panel">
          <p>
            <strong>ID проекта:</strong> {projectId}
          </p>
          <div className="actions">
            <Link to="/projects" className="button-link button-link--secondary">
              Вернуться к списку проектов
            </Link>
            <Link to={`/projects/${PROJECT_ID}`} className="button-link">
              Открыть AISTROYKA
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Проект</p>
        <h1>{PROJECT_NAME}</h1>
        <p className="lede">
          Текущее состояние, лента событий, новые решения и переходы в отдельные поверхности
          задач и хэнд-оффов.
        </p>
      </header>

      <div className="grid">
        <section className="panel">
          <h2>Состояние</h2>
          {stateSummary ? (
            <div className="state-block">
              <div>
                Stage: <strong>{stateSummary.stage}</strong>
              </div>
              <div>Completed: {stateSummary.completed}</div>
              <div>Next: {stateSummary.next}</div>
              <div>Active decisions: {stateSummary.active}</div>
            </div>
          ) : (
            <p className="hint">Состояние проекта пока не записано.</p>
          )}
        </section>

        <section className="panel">
          <h2>Действия</h2>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void onStoreDecision();
            }}
          >
            <label>
              Decision title
              <input value={title} onChange={(event) => onTitleChange(event.target.value)} required />
            </label>
            <label>
              Content
              <textarea
                rows={4}
                value={content}
                onChange={(event) => onContentChange(event.target.value)}
                required
              />
            </label>
            <div className="actions">
              <button type="submit">Remember decision</button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  void onCreateHandoff();
                }}
              >
                Cursor → ChatGPT хэнд-офф
              </button>
              <Link to="/tasks" className="button-link button-link--secondary">
                Открыть задачи
              </Link>
              <Link to="/handoffs" className="button-link button-link--secondary">
                Открыть хэнд-оффы
              </Link>
            </div>
          </form>
        </section>
      </div>

      <section className="panel">
        <h2>Лента проекта</h2>
        <Timeline entries={latestTimeline} emptyMessage="Лента проекта пока пуста." />
      </section>

      <section className="panel" id="review-queue">
        <h2>Очередь на проверку</h2>
        <p className="hint">
          Полный flow разрешения конфликтов вынесен на отдельную страницу, но быстрые действия
          остаются и здесь.
        </p>
        <div className="actions">
          <Link to="/conflicts" className="button-link button-link--secondary">
            Открыть страницу конфликтов
          </Link>
        </div>
        {reviewQueueLoading && reviewQueue.length > 0 ? (
          <p className="hint">Обновляю очередь…</p>
        ) : null}
        <ReviewQueueList
          actor={actor}
          items={reviewQueue}
          source="review"
          projectId={projectId}
          emptyMessage={
            reviewQueueLoading
              ? 'Загружаю очередь…'
              : 'Сейчас нет кандидатов или спорных записей.'
          }
          onSetStatus={onSetReviewStatus}
        />
      </section>
    </section>
  );
}
