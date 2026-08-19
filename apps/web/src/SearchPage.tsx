import type { ReactNode } from 'react';
import { SearchResults } from './SearchResults';
import { type SearchContext, type SearchHit } from './controlCenter';

type Props = {
  scopeLabel: string;
  scopePanel: ReactNode;
  search: string;
  packContext: boolean;
  searchContext: SearchContext | null;
  hits: SearchHit[];
  onSearchTermChange: (value: string) => void;
  onPackContextChange: (value: boolean) => void;
  onSearch: () => void | Promise<void>;
};

export function SearchPage({
  scopeLabel,
  scopePanel,
  search,
  packContext,
  searchContext,
  hits,
  onSearchTermChange,
  onPackContextChange,
  onSearch,
}: Props) {
  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Поиск</p>
        <h1>Глобальный поиск по памяти</h1>
        <p className="lede">
          Ищите решения, заметки и состояние проекта по {scopeLabel} без служебных деталей
          интерфейса.
        </p>
      </header>

      {scopePanel}

      <section className="panel">
        <h2>Запрос</h2>
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            void onSearch();
          }}
        >
          <label>
            Что найти
            <input
              value={search}
              onChange={(event) => onSearchTermChange(event.target.value)}
              placeholder="Например: Slice 01"
            />
          </label>

          <div className="actions">
            <button type="submit">Искать</button>
          </div>

          <details className="details-panel">
            <summary>Advanced</summary>
            <div className="details-panel__body">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={packContext}
                  onChange={(event) => onPackContextChange(event.target.checked)}
                />
                <span>Pack context for agents</span>
              </label>

              {searchContext?.text ? (
                <div className="item item--plain">
                  <div className="meta">
                    <span className="badge state">context</span>
                    <span>
                      packed {searchContext.packedCount ?? 0}
                      {searchContext.truncated ? ' · truncated' : ''}
                    </span>
                  </div>
                  <pre className="preformatted">{searchContext.text}</pre>
                </div>
              ) : (
                <p className="hint">Контекст для агентов появится после поиска с Advanced.</p>
              )}
            </div>
          </details>
        </form>
      </section>

      <section className="panel">
        <h2>Результаты</h2>
        <SearchResults hits={hits} search={search} />
      </section>
    </section>
  );
}
