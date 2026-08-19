import { Link } from 'react-router-dom';
import { type BackendMode } from './controlCenter';

type Props = {
  backend: BackendMode;
};

function describeBackendMode(backend: BackendMode): string {
  switch (backend) {
    case 'local':
      return 'Локальный preview';
    case 'memory-store':
    case 'supabase':
      return 'Подключенный API backend';
    default: {
      const exhaustiveCheck: never = backend;
      return exhaustiveCheck;
    }
  }
}

export function AuditPage({ backend }: Props) {
  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Аудит</p>
        <h1>Аудит действий и событий</h1>
        <p className="lede">
          В текущем срезе Control Center не придумывает строки аудита. Экран показывает только то,
          что уже реально доступно через backend.
        </p>
      </header>

      <div className="cta-row">
        <Link to="/privacy" className="button-link">
          Открыть приватность
        </Link>
        <Link to="/" className="button-link button-link--secondary">
          На главную
        </Link>
        <Link to="/conflicts" className="button-link button-link--secondary">
          К конфликтам
        </Link>
      </div>

      <div className="grid surface-grid">
        <section className="panel">
          <h2>Лента аудита пока недоступна</h2>
          <div className="stat-grid">
            <article className="stat-card">
              <span className="stat-card__label">Текущий режим</span>
              <strong>{describeBackendMode(backend)}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-card__label">API журнала владельца</span>
              <strong>Не найден</strong>
            </article>
          </div>
          <p className="hint">
            В текущем <code>main</code> нет endpoint-а чтения для owner audit trail: <code>GET
            /v1/audit</code> или эквивалент не реализован. В коде есть write path <code>POST
            /v1/ingestion/events</code>, но это не экран просмотра аудита.
          </p>
          <p className="hint">
            Поэтому здесь нет synthetic rows, мок-таймлайна или подмены outbox под аудит. Как только
            backend откроет честный read API, экран можно будет привязать к нему без смены route.
          </p>
        </section>

        <section className="panel">
          <h2>Что доступно уже сейчас</h2>
          <ul className="surface-bullets">
            <li>
              <Link to="/">Главная</Link> показывает project timeline и последние изменения
              состояния, но это не полный audit log.
            </li>
            <li>
              <Link to="/connections">Подключения</Link> уже показывают статус коннекторов, sync и
              ошибки повторной авторизации.
            </li>
            <li>
              <Link to="/conflicts">Конфликты</Link> и Inspector остаются действующим путем для
              dispute/retract по отдельным записям памяти.
            </li>
          </ul>
        </section>
      </div>
    </section>
  );
}
