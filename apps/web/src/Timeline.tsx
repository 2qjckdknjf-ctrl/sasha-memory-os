import { Link } from 'react-router-dom';
import { formatTimestamp, type TimelineEntry } from './controlCenter';

type Props = {
  entries: TimelineEntry[];
  emptyMessage: string;
};

export function Timeline({ entries, emptyMessage }: Props) {
  if (entries.length === 0) {
    return <p className="hint">{emptyMessage}</p>;
  }

  return (
    <ul className="timeline">
      {entries.map((entry, index) => {
        switch (entry.kind) {
          case 'decision':
            return (
              <li className="item" key={`decision-${entry.at}-${index}`}>
                <div className="meta">
                  <span className="badge decision">decision</span>
                  <span>{entry.status}</span>
                  <span>{formatTimestamp(entry.at)}</span>
                </div>
                <h3>
                  {entry.memoryId ? (
                    <Link
                      to={`/memories/${entry.memoryId}`}
                      state={{ from: 'timeline' as const, projectId: entry.projectId ?? null }}
                    >
                      {entry.title}
                    </Link>
                  ) : (
                    entry.title
                  )}
                </h3>
                <p>{entry.content}</p>
              </li>
            );
          case 'state':
            return (
              <li className="item" key={`state-${entry.at}-${entry.version}-${index}`}>
                <div className="meta">
                  <span className="badge state">state v{entry.version}</span>
                  <span>{formatTimestamp(entry.at)}</span>
                </div>
                <h3>{entry.summary}</h3>
                <p>Next: {entry.next}</p>
              </li>
            );
          case 'handoff':
            return (
              <li className="item" key={`handoff-${entry.at}-${index}`}>
                <div className="meta">
                  <span className="badge handoff">handoff</span>
                  <span>{formatTimestamp(entry.at)}</span>
                </div>
                <h3>Agent handoff</h3>
                <p>{entry.summary}</p>
              </li>
            );
          default: {
            const exhaustiveCheck: never = entry;
            return exhaustiveCheck;
          }
        }
      })}
    </ul>
  );
}
