import { Link } from 'react-router-dom';
import { ACTOR_LABELS, type Actor, type BackendMode } from './controlCenter';

type Props = {
  actor: Actor;
  backend: BackendMode;
  onExportMemories: () => void | Promise<void>;
};

function describeAvailability(enabled: boolean): string {
  return enabled ? 'Доступно' : 'Недоступно';
}

export function PrivacyPage({ actor, backend, onExportMemories }: Props) {
  const isOwner = actor === 'owner';
  const exportAvailable = isOwner && backend !== 'local';

  let exportHint = 'Экспорт использует существующий endpoint GET /v1/export/memories.';
  if (!isOwner) {
    exportHint =
      'Экспорт доступен только владельцу. Переключение акторов для demo по-прежнему остаётся на /ops.';
  } else if (backend === 'local') {
    exportHint =
      'Экспорт требует подключенный API backend. В локальном preview страница не притворяется, что выгрузка сработает.';
  }

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Приватность</p>
        <h1>Экспорт, удаление и корректировка памяти</h1>
        <p className="lede">
          Экран показывает только реальные privacy flows текущего билда: существующий экспорт и
          честные ограничения там, где API ещё нет.
        </p>
      </header>

      <div className="cta-row">
        <Link to="/audit" className="button-link button-link--secondary">
          Открыть аудит
        </Link>
        <Link to="/conflicts" className="button-link button-link--secondary">
          Открыть конфликты
        </Link>
        <Link to="/search" className="button-link button-link--secondary">
          Найти запись
        </Link>
      </div>

      <section className="panel">
        <h2>Экспорт данных владельца</h2>
        <div className="stat-grid">
          <article className="stat-card">
            <span className="stat-card__label">Экспорт API</span>
            <strong>{describeAvailability(backend !== 'local')}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-card__label">Текущий актор</span>
            <strong>{ACTOR_LABELS[actor]}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-card__label">Право на выгрузку</span>
            <strong>{describeAvailability(exportAvailable)}</strong>
          </article>
        </div>
        <p className="hint" id="privacy-export-hint">
          {exportHint}
        </p>
        <div className="actions">
          <button
            type="button"
            disabled={!exportAvailable}
            aria-describedby="privacy-export-hint"
            onClick={() => {
              void onExportMemories();
            }}
          >
            Скачать JSON-экспорт памяти
          </button>
        </div>
      </section>

      <div className="grid surface-grid">
        <section className="panel">
          <h2>Запрос на удаление / forget</h2>
          <p className="hint">
            В текущем <code>main</code> нет отдельного API для owner delete/privacy request. Endpoint
            вида <code>POST /v1/privacy/deletions</code> не реализован, поэтому форма отправки
            запроса здесь намеренно отсутствует.
          </p>
          <ul className="surface-bullets">
            <li>Никакого локального “удаления” только в UI эта страница не делает.</li>
            <li>
              Если запись ошибочна уже сейчас, используйте существующий retract/dispute flow через
              Inspector и очередь конфликтов.
            </li>
          </ul>
          <div className="actions">
            <Link to="/conflicts" className="button-link button-link--secondary">
              К очереди конфликтов
            </Link>
          </div>
        </section>

        <section className="panel">
          <h2>Запрос на корректировку / supersede</h2>
          <p className="hint">
            Owner API для корректировки с reason пока нет: в текущем backend не найден отдельный
            endpoint для correct/supersede request, и экран не подменяет его локальной формой.
          </p>
          <ul className="surface-bullets">
            <li>
              <Link to="/conflicts">Конфликты</Link> уже поддерживают dispute/retract и запуск
              существующей консолидации кандидатов.
            </li>
            <li>
              <Link to="/search">Поиск</Link> помогает быстро найти нужную запись, после чего можно
              открыть Inspector и отозвать её.
            </li>
          </ul>
        </section>
      </div>
    </section>
  );
}
