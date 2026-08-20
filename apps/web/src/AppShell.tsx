import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { describeBackend, type BackendMode } from './controlCenter';

type Props = {
  backend: BackendMode;
  boundSubjectId: string | null;
  authPanel: ReactNode;
  error: string | null;
  notice: string | null;
  seedShortcutTo: string | null;
  children: ReactNode;
};

type PrimaryLink = {
  to: string;
  label: string;
  end?: boolean;
};

const primaryLinks: PrimaryLink[] = [
  { to: '/', label: 'Главная', end: true },
  { to: '/connections', label: 'Подключения' },
  { to: '/agents', label: 'Агенты и права' },
  { to: '/tasks', label: 'Задачи' },
  { to: '/handoffs', label: 'Хэнд-оффы' },
  { to: '/conflicts', label: 'Конфликты' },
  { to: '/search', label: 'Поиск' },
  { to: '/projects', label: 'Проекты', end: true },
];

const secondaryLinks: PrimaryLink[] = [
  { to: '/audit', label: 'Аудит' },
  { to: '/transferred-objects', label: 'Apple objects' },
  { to: '/privacy', label: 'Приватность' },
];

const mainContentId = 'main-content';

export function AppShell({
  backend,
  boundSubjectId,
  authPanel,
  error,
  notice,
  seedShortcutTo,
  children,
}: Props) {
  const navLinks = seedShortcutTo
    ? [...primaryLinks, { to: `/projects/${seedShortcutTo}`, label: 'Проект AISTROYKA' }]
    : primaryLinks;
  return (
    <>
      <a className="skip-link" href={`#${mainContentId}`}>
        Перейти к основному содержимому
      </a>
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
              {navLinks.map((link) => (
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

            <div className="shell-nav__group shell-nav__group--secondary">
              {secondaryLinks.map((link) => (
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

          {notice ? (
            <div className="banner" role="status" aria-live="polite">
              {notice}
            </div>
          ) : null}

          <main className="shell__main" id={mainContentId} tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
