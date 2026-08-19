import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { PROJECT_ID, describeBackend, type BackendMode } from './controlCenter';

type Props = {
  backend: BackendMode;
  boundSubjectId: string | null;
  authPanel: ReactNode;
  error: string | null;
  notice: string | null;
  children: ReactNode;
};

type PrimaryLink = {
  to: string;
  label: string;
  end?: boolean;
};

const primaryLinks: PrimaryLink[] = [
  { to: '/', label: 'Главная', end: true },
  { to: '/tasks', label: 'Задачи' },
  { to: '/handoffs', label: 'Хэнд-оффы' },
  { to: '/conflicts', label: 'Конфликты' },
  { to: '/search', label: 'Поиск' },
  { to: `/projects/${PROJECT_ID}`, label: 'Проект AISTROYKA' },
];

const secondaryLabels = ['Connections', 'Audit', 'Privacy'];

export function AppShell({
  backend,
  boundSubjectId,
  authPanel,
  error,
  notice,
  children,
}: Props) {
  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <div className="shell__brand">
          <p className="eyebrow">Sasha Memory OS</p>
          <p className="shell__brand-title">Control Center</p>
          <p className="lede">
            Управление памятью проекта без служебной операционки в основном интерфейсе.
          </p>
        </div>

        <nav aria-label="Основная навигация" className="shell-nav">
          <div className="shell-nav__group">
            {primaryLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  isActive ? 'shell-nav__link shell-nav__link--active' : 'shell-nav__link'
                }
              >
                {link.label}
              </NavLink>
            ))}
          </div>

          <div className="shell-nav__group shell-nav__group--secondary" aria-label="Скоро">
            {secondaryLabels.map((label) => (
              <span key={label} className="shell-nav__soon">
                {label}
                <small>скоро</small>
              </span>
            ))}
          </div>
        </nav>
      </aside>

      <div className="shell__content">
        <header className="shell__header">
          <div>
            <p className="eyebrow">Статус</p>
            <div className="status-line">
              <span className="status-pill">{describeBackend(backend)}</span>
              {boundSubjectId ? (
                <span className="meta">Сессия владельца подключена</span>
              ) : (
                <span className="meta">Можно войти для привязки веб-сессии</span>
              )}
            </div>
          </div>

          <div className="shell__header-actions">
            <details className="session-panel">
              <summary>Сессия и вход</summary>
              <div className="session-panel__body">
                {boundSubjectId ? (
                  <p className="meta">
                    Привязанный субъект: {boundSubjectId.slice(0, 8)}
                    …
                  </p>
                ) : null}
                {authPanel}
              </div>
            </details>
            <NavLink to="/ops" className="dev-link">
              Для разработчика
            </NavLink>
          </div>
        </header>

        {error ? (
          <div className="banner banner--warn" role="alert">
            {error}
          </div>
        ) : null}

        {notice ? <div className="banner">{notice}</div> : null}

        <main className="shell__main">{children}</main>
      </div>
    </div>
  );
}
