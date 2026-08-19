import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatTimestamp } from './controlCenter';
import { describeTaskLane, type TaskSurfaceData, type TaskSurfaceItem } from './surfaces';

type Props = {
  scopeLabel: string;
  scopePanel: ReactNode;
  taskSurface: TaskSurfaceData;
};

type TaskListProps = {
  items: TaskSurfaceItem[];
  emptyMessage: string;
};

function TaskList({ items, emptyMessage }: TaskListProps) {
  if (items.length === 0) {
    return <p className="hint">{emptyMessage}</p>;
  }

  return (
    <ul className="timeline">
      {items.map((item) => (
        <li className="item" key={item.id}>
          <div className="meta">
            <span className={`badge badge--task badge--task-${item.lane}`}>
              {describeTaskLane(item.lane)}
            </span>
            <span>{item.source === 'memory' ? 'память' : 'состояние проекта'}</span>
            {item.status ? <span>{item.status}</span> : null}
            {item.recordedAt ? <span>{formatTimestamp(item.recordedAt)}</span> : null}
          </div>
          <h3>
            {item.memoryId ? (
              <Link
                to={`/memories/${item.memoryId}`}
                state={{ from: 'project' as const, projectId: item.projectId ?? null }}
              >
                {item.title}
              </Link>
            ) : (
              item.title
            )}
          </h3>
          <p>{item.detail}</p>
          {item.memoryId ? (
            <div className="actions">
              <Link
                to={`/memories/${item.memoryId}`}
                state={{ from: 'project' as const, projectId: item.projectId ?? null }}
                className="button-link button-link--secondary"
              >
                Открыть инспектор
              </Link>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function TasksPage({ scopeLabel, scopePanel, taskSurface }: Props) {
  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Задачи</p>
        <h1>Задачи Memory OS</h1>
        <p className="lede">
          Поверхность задач по {scopeLabel}. Список собран из project state и записей памяти типа{' '}
          <code>task</code>, потому что отдельного list API для задач сейчас нет.
        </p>
      </header>

      {scopePanel}

      <div className="cta-row">
        <Link to="/projects" className="button-link button-link--secondary">
          Каталог проектов
        </Link>
        <Link to="/search" className="button-link button-link--secondary">
          Поиск по памяти
        </Link>
      </div>

      <section className="panel">
        <h2>Сводка</h2>
        <div className="stat-grid">
          <div className="stat-card">
            <span className="stat-card__label">Открыто</span>
            <strong>{taskSurface.counts.outstanding}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-card__label">В работе</span>
            <strong>{taskSurface.counts.inProgress}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-card__label">Блокеры</span>
            <strong>{taskSurface.counts.blocked}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-card__label">Записи типа task</span>
            <strong>{taskSurface.counts.memory}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-card__label">Завершено</span>
            <strong>{taskSurface.counts.completed}</strong>
          </div>
        </div>
      </section>

      <div className="grid surface-grid">
        <section className="panel">
          <h2>Открытые задачи</h2>
          <p className="hint">
            Здесь объединены записи типа task, <code>next</code>, <code>in_progress</code> и{' '}
            <code>blocked</code> из состояния проекта.
          </p>
          <TaskList
            items={taskSurface.outstanding}
            emptyMessage="Открытых задач в текущем срезе не найдено."
          />
        </section>

        <section className="panel">
          <h2>Завершенные задачи</h2>
          <p className="hint">Берутся из поля completed в состоянии проекта.</p>
          <TaskList
            items={taskSurface.completed}
            emptyMessage="Завершенные задачи пока не отмечены."
          />
        </section>
      </div>
    </section>
  );
}
