import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  describeMemoryStatus,
  type Actor,
  type AttentionItemSource,
  type MemoryStatusAction,
  type ReviewQueueItem,
} from './controlCenter';

type Props = {
  actor: Actor;
  items: ReviewQueueItem[];
  source: AttentionItemSource;
  projectId?: string | null;
  emptyMessage: string;
  onSetStatus: (memoryId: string, status: MemoryStatusAction) => void | Promise<boolean>;
};

const ATTENTION_STATUS_ORDER: Record<string, number> = {
  disputed: 0,
  candidate: 1,
  superseded: 2,
};

export function ReviewQueueList({
  actor,
  items,
  source,
  projectId = null,
  emptyMessage,
  onSetStatus,
}: Props) {
  const [pendingMemoryId, setPendingMemoryId] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<MemoryStatusAction | null>(null);

  const sortedItems = useMemo(
    () =>
      [...items].sort((left, right) => {
        const leftRank = ATTENTION_STATUS_ORDER[left.status] ?? Number.MAX_SAFE_INTEGER;
        const rightRank = ATTENTION_STATUS_ORDER[right.status] ?? Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        return left.title.localeCompare(right.title, 'ru');
      }),
    [items],
  );

  async function handleSetStatus(memoryId: string, status: MemoryStatusAction) {
    setPendingMemoryId(memoryId);
    setPendingStatus(status);
    try {
      await onSetStatus(memoryId, status);
    } finally {
      setPendingMemoryId(null);
      setPendingStatus(null);
    }
  }

  if (sortedItems.length === 0) {
    return <p className="hint">{emptyMessage}</p>;
  }

  return (
    <ul className="timeline">
      {sortedItems.map((item) => {
        const itemPending = pendingMemoryId === item.id;

        return (
          <li className="item" key={item.id}>
            <div className="meta">
              <span className="badge state">{describeMemoryStatus(item.status)}</span>
            </div>
            <h3>
              <Link
                to={`/memories/${item.id}`}
                state={{ from: source, projectId }}
              >
                {item.title}
              </Link>
            </h3>
            <p>{item.content}</p>
            <div className="actions">
              {actor === 'owner' ? (
                <>
                  <button
                    type="button"
                    disabled={itemPending || item.status === 'verified'}
                    onClick={() => {
                      void handleSetStatus(item.id, 'verified');
                    }}
                  >
                    Подтвердить
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={itemPending || item.status === 'disputed'}
                    onClick={() => {
                      void handleSetStatus(item.id, 'disputed');
                    }}
                  >
                    Оспорить
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={itemPending || item.status === 'retracted'}
                    onClick={() => {
                      void handleSetStatus(item.id, 'retracted');
                    }}
                  >
                    Отозвать
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={itemPending || item.status === 'disputed'}
                  onClick={() => {
                    void handleSetStatus(item.id, 'disputed');
                  }}
                >
                  Оспорить
                </button>
              )}
            </div>
            {itemPending && pendingStatus ? (
              <p className="hint">Обновляю статус: {pendingStatus}…</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
