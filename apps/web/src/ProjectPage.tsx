import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PROJECT_ID,
  PROJECT_NAME,
  type ReviewQueueItem,
  type StateSummary,
  type TimelineEntry,
} from './controlCenter';
import { Timeline } from './Timeline';

type Props = {
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
          <h1>Проект не найден</h1>
          <p className="lede">
            В этом срезе доступен только seed-проект AISTROYKA без каталога проектов.
          </p>
        </header>

        <Link to={`/projects/${PROJECT_ID}`} className="button-link">
          Открыть AISTROYKA
        </Link>
      </section>
    );
  }

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Проект</p>
        <h1>{PROJECT_NAME}</h1>
        <p className="lede">
          Текущее состояние, лента событий, новые решения и handoff между Cursor и ChatGPT.
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
                Cursor → ChatGPT handoff
              </button>
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
        {reviewQueueLoading ? <p className="hint">Загружаю очередь…</p> : null}
        {!reviewQueueLoading && reviewQueue.length === 0 ? (
          <p className="hint">Сейчас нет кандидатов или спорных записей.</p>
        ) : null}

        {reviewQueue.length > 0 ? (
          <ul className="timeline">
            {reviewQueue.map((item) => (
              <li className="item" key={item.id}>
                <div className="meta">
                  <span className="badge state">{item.status}</span>
                </div>
                <h3>{item.title}</h3>
                <p>{item.content}</p>
                <div className="actions">
                  <button
                    type="button"
                    onClick={() => {
                      void onSetReviewStatus(item.id, 'verified');
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => {
                      void onSetReviewStatus(item.id, 'disputed');
                    }}
                  >
                    Dispute
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => {
                      void onSetReviewStatus(item.id, 'retracted');
                    }}
                  >
                    Retract
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  );
}
