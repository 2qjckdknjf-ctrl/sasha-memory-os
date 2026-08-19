import { type SearchHit } from './controlCenter';

type Props = {
  hits: SearchHit[];
};

export function SearchResults({ hits }: Props) {
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
            <h3>{hit.memory?.title ?? 'Untitled memory'}</h3>
            <p>{hit.memory?.content ?? ''}</p>
          </li>
        );
      })}
    </ul>
  );
}
