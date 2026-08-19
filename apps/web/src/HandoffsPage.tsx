import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PROJECT_ID, PROJECT_NAME, formatTimestamp } from './controlCenter';
import {
  DEFAULT_HANDOFF_PAYLOAD,
  describeHandoffActors,
  describeHandoffSource,
  type HandoffPayloadInput,
  type HandoffSurfaceData,
  type HandoffSurfaceItem,
} from './surfaces';

type Props = {
  handoffSurface: HandoffSurfaceData;
  onCreateHandoff: (payload: HandoffPayloadInput) => Promise<void> | void;
};

type PayloadListProps = {
  title: string;
  items: string[];
  emptyMessage: string;
};

function joinLines(items: string[]): string {
  return items.join('\n');
}

function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function PayloadList({ title, items, emptyMessage }: PayloadListProps) {
  return (
    <section className="surface-section">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="hint">{emptyMessage}</p>
      ) : (
        <ul className="surface-bullets">
          {items.map((item) => (
            <li key={`${title}-${item}`}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HandoffDetail({ handoff }: { handoff: HandoffSurfaceItem | null }) {
  if (!handoff) {
    return <p className="hint">Выберите хэнд-офф слева или создайте новый.</p>;
  }

  return (
    <div className="surface-stack">
      <div className="meta">
        <span className="badge handoff">handoff</span>
        <span>{describeHandoffSource(handoff.source)}</span>
        <span>{formatTimestamp(handoff.createdAt)}</span>
      </div>
      <h2>{describeHandoffActors(handoff)}</h2>
      <p className="lede surface-lede">{handoff.summary}</p>

      <PayloadList
        title="Что завершено"
        items={handoff.payload.completed}
        emptyMessage="В handoff нет списка завершенных пунктов."
      />
      <PayloadList
        title="Открытые пункты"
        items={handoff.payload.openItems}
        emptyMessage="Открытых пунктов нет."
      />
      <PayloadList
        title="Что делать дальше"
        items={handoff.payload.recommendedNext}
        emptyMessage="Следующие шаги не указаны."
      />
      <PayloadList
        title="Проверки"
        items={handoff.payload.validation}
        emptyMessage="Проверки не перечислены."
      />
      <PayloadList
        title="Блокеры"
        items={handoff.payload.blockers}
        emptyMessage="Блокеры не указаны."
      />

      <section className="surface-section">
        <h3>Артефакты</h3>
        {handoff.payload.artifacts.length === 0 ? (
          <p className="hint">Артефакты не приложены.</p>
        ) : (
          <pre className="preformatted">{JSON.stringify(handoff.payload.artifacts, null, 2)}</pre>
        )}
      </section>
    </div>
  );
}

export function HandoffsPage({ handoffSurface, onCreateHandoff }: Props) {
  const [completedText, setCompletedText] = useState(joinLines(DEFAULT_HANDOFF_PAYLOAD.completed));
  const [validationText, setValidationText] = useState(joinLines(DEFAULT_HANDOFF_PAYLOAD.validation));
  const [openItemsText, setOpenItemsText] = useState(joinLines(DEFAULT_HANDOFF_PAYLOAD.openItems));
  const [blockersText, setBlockersText] = useState(joinLines(DEFAULT_HANDOFF_PAYLOAD.blockers));
  const [recommendedText, setRecommendedText] = useState(
    joinLines(DEFAULT_HANDOFF_PAYLOAD.recommendedNext),
  );
  const [selectedId, setSelectedId] = useState<string | null>(handoffSurface.items[0]?.id ?? null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!handoffSurface.items.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !handoffSurface.items.some((item) => item.id === selectedId)) {
      setSelectedId(handoffSurface.items[0].id);
    }
  }, [handoffSurface.items, selectedId]);

  const selected = useMemo(
    () => handoffSurface.items.find((item) => item.id === selectedId) ?? handoffSurface.items[0] ?? null,
    [handoffSurface.items, selectedId],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onCreateHandoff({
        completed: parseLines(completedText),
        artifacts: [],
        validation: parseLines(validationText),
        openItems: parseLines(openItemsText),
        blockers: parseLines(blockersText),
        recommendedNext: parseLines(recommendedText),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Хэнд-оффы</p>
        <h1>Хэнд-оффы между агентами</h1>
        <p className="lede">
          Поверхность handoff для владельца по {PROJECT_NAME}. Создание идет через{' '}
          <code>POST /v1/handoffs</code>, а история читается через <code>GET /v1/handoffs</code>.
        </p>
      </header>

      <div className="cta-row">
        <Link to={`/projects/${PROJECT_ID}`} className="button-link button-link--secondary">
          Открыть проект
        </Link>
        <Link to="/tasks" className="button-link button-link--secondary">
          Открыть задачи
        </Link>
      </div>

      {!handoffSurface.historyAvailable ? (
        <div className="panel panel--note">
          <p className="hint">
            История из backend сейчас недоступна, поэтому здесь показаны только хэнд-оффы из текущей
            веб-сессии и последний известный handoff.
          </p>
        </div>
      ) : null}

      <div className="grid surface-grid">
        <section className="panel">
          <h2>Создать Cursor → ChatGPT хэнд-офф</h2>
          <p className="hint">
            По одной строке на пункт. Этот flow использует уже существующую схему payload.
          </p>
          <form className="form" onSubmit={(event) => void handleSubmit(event)}>
            <label>
              Что завершено
              <textarea
                rows={3}
                value={completedText}
                onChange={(event) => setCompletedText(event.target.value)}
              />
            </label>
            <label>
              Проверки
              <textarea
                rows={2}
                value={validationText}
                onChange={(event) => setValidationText(event.target.value)}
              />
            </label>
            <label>
              Открытые пункты
              <textarea
                rows={3}
                value={openItemsText}
                onChange={(event) => setOpenItemsText(event.target.value)}
              />
            </label>
            <label>
              Блокеры
              <textarea
                rows={2}
                value={blockersText}
                onChange={(event) => setBlockersText(event.target.value)}
              />
            </label>
            <label>
              Что делать дальше
              <textarea
                rows={3}
                value={recommendedText}
                onChange={(event) => setRecommendedText(event.target.value)}
              />
            </label>
            <div className="actions">
              <button type="submit" disabled={submitting}>
                {submitting ? 'Создаю…' : 'Создать хэнд-офф'}
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <h2>Список хэнд-оффов</h2>
          {handoffSurface.items.length === 0 ? (
            <p className="hint">История хэнд-оффов пока пуста.</p>
          ) : (
            <ul className="surface-selector" aria-label="История хэнд-оффов">
              {handoffSurface.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={item.id === selectedId}
                    className={
                      item.id === selectedId
                        ? 'surface-selector__button surface-selector__button--active'
                        : 'surface-selector__button'
                    }
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className="meta">
                      <span className="badge handoff">handoff</span>
                      <span>{describeHandoffSource(item.source)}</span>
                      <span>{formatTimestamp(item.createdAt)}</span>
                    </span>
                    <strong>{describeHandoffActors(item)}</strong>
                    <span className="hint">{item.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <HandoffDetail handoff={selected} />
      </section>
    </section>
  );
}
