import { Link } from 'react-router-dom';
import { type SearchHit } from './controlCenter';

type Props = {
  hits: SearchHit[];
  search: string;
};

export function SearchResults({ hits, search }: Props) {
  if (hits.length === 0) {
    return <p className="hint">Поиск пока не вернул совпадений.</p>;
  }

  return (
    <ul className="timeline search-results">
      {hits.map((hit, index) => {
        const memoryType = hit.memory?.memoryType ?? hit.memory?.type;

        return (
          <li className="item" key={hit.memory?.id ?? `hit-${index}`}>
            <div className="meta">
              <span className="badge state">{hit.memory?.status ?? 'unknown'}</span>
              {memoryType ? <span>type {memoryType}</span> : null}
              {hit.reason ? <span>{hit.reason}</span> : null}
              {typeof hit.score === 'number' ? (
                <span>score {hit.score.toFixed(4)}</span>
              ) : null}
            </div>
            <h3>
              {hit.memory?.id ? (
                <Link
                  to={`/memories/${hit.memory.id}`}
                  state={{
                    from: 'search' as const,
                    searchTerm: search,
                    projectId: hit.memory.projectId ?? null,
                  }}
                >
                  {hit.memory?.title ?? 'Без названия'}
                </Link>
              ) : (
                (hit.memory?.title ?? 'Без названия')
              )}
            </h3>
            <p>{hit.memory?.content ?? ''}</p>
            {hit.memory?.id ? (
              <div className="actions">
                <Link
                  to={`/memories/${hit.memory.id}`}
                  state={{
                    from: 'search' as const,
                    searchTerm: search,
                    projectId: hit.memory.projectId ?? null,
                  }}
                  className="button-link button-link--secondary"
                >
                  Открыть инспектор
                </Link>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
