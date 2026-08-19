import { Link } from 'react-router-dom';
import {
  type ConnectionHealthRecord,
  type ConnectorDefinitionRecord,
  describeConnectionStatus,
  formatTimestamp,
  type BackendMode,
  type ConnectionRecord,
} from './controlCenter';

type OAuthStartOptions = {
  connectorId?: string;
  displayName?: string;
  scopes?: string[];
};

type Props = {
  backend: BackendMode;
  connectors: ConnectorDefinitionRecord[];
  connections: ConnectionRecord[];
  connectionHealth: Record<string, ConnectionHealthRecord>;
  onRefresh: () => void;
  onConnectGmailStub: () => void | Promise<void>;
  onStartOAuth: (options?: OAuthStartOptions) => void | Promise<void>;
  onSyncConnections: (connectionId?: string) => void | Promise<void>;
  onRevokeConnection: (id: string) => void | Promise<void>;
};

function describeConnector(connectorId?: string): string {
  switch (connectorId) {
    case 'github':
      return 'GitHub';
    case 'gmail':
      return 'Gmail';
    case 'google-drive':
      return 'Google Drive';
    case 'google-calendar':
      return 'Google Calendar';
    case undefined:
      return 'Коннектор';
    default:
      return connectorId;
  }
}

function describeConnectionMessage(connection: ConnectionRecord): string {
  if (connection.status === 'reauth_required') {
    return connection.lastError ?? 'Требуется повторная авторизация для возобновления синхронизации.';
  }
  if (connection.lastError) {
    return connection.lastError;
  }
  if (connection.status === 'revoked') {
    return 'Доступ отозван. Повторное подключение потребуется перед следующей синхронизацией.';
  }
  if (connection.status === 'disabled') {
    return 'Коннектор отключен в текущем состоянии рабочей области.';
  }
  if (connection.status === 'degraded') {
    return 'Последняя синхронизация завершилась с ошибками.';
  }
  return 'Ошибки синхронизации не обнаружены.';
}

export function ConnectionsPage({
  backend,
  connectors,
  connections,
  connectionHealth,
  onRefresh,
  onConnectGmailStub,
  onStartOAuth,
  onSyncConnections,
  onRevokeConnection,
}: Props) {
  const actionsDisabled = backend === 'local';
  const needsAttention = connections.filter(
    (connection) =>
      connection.status === 'reauth_required' ||
      connection.status === 'degraded' ||
      Boolean(connection.lastError),
  );
  const connectedCount = connections.filter((connection) => connection.status === 'connected').length;
  const hasGmail = connections.some((connection) => connection.connectorId === 'gmail');

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Подключения</p>
        <h1>Подключения и синхронизация</h1>
        <p className="lede">
          Статус коннекторов доступен прямо в Control Center. Здесь показываются существующие
          подключения, ошибки синхронизации и действия, которые уже поддерживают текущие API.
        </p>
      </header>

      <div className="cta-row">
        <button type="button" className="button-link button-link--secondary" onClick={onRefresh}>
          Обновить статус
        </button>
        <button
          type="button"
          className="button-link"
          disabled={actionsDisabled}
          onClick={() => {
            void onSyncConnections();
          }}
        >
          Синхронизировать все
        </button>
        <Link to="/agents" className="button-link button-link--secondary">
          Права агентов
        </Link>
      </div>

      <section className="panel">
        <h2>Каталог коннекторов</h2>
        {connectors.length === 0 ? (
          <p className="hint">Каталог пока недоступен.</p>
        ) : (
          <ul className="timeline" aria-label="Каталог коннекторов">
            {connectors.map((connector) => {
              const connectorLabel = connector.displayName ?? describeConnector(connector.id);
              const supportsOauth = connector.id === 'github';
              const isGmailStub = connector.id === 'gmail';
              const isConnected = connections.some((connection) => connection.connectorId === connector.id);
              return (
                <li className="item" key={connector.id}>
                  <div className="meta">
                    <span className="badge state">{connector.authType ?? 'custom'}</span>
                    <span>{connectorLabel}</span>
                    {connector.version ? <span>v{connector.version}</span> : null}
                  </div>
                  <h3>{connectorLabel}</h3>
                  <p>
                    Capabilities:{' '}
                    {connector.capabilities && connector.capabilities.length > 0
                      ? connector.capabilities.join(', ')
                      : 'not declared'}
                  </p>
                  <p className="hint">
                    Storage modes:{' '}
                    {connector.storageModes && connector.storageModes.length > 0
                      ? connector.storageModes.join(', ')
                      : 'reference'}
                  </p>
                  <div className="actions">
                    {supportsOauth ? (
                      <button
                        type="button"
                        disabled={actionsDisabled}
                        onClick={() => {
                          void onStartOAuth({
                            connectorId: connector.id,
                            displayName: isConnected ? connectorLabel : 'AISTROYKA repos',
                            scopes: ['repositories.read'],
                          });
                        }}
                      >
                        {isConnected ? 'Переподключить GitHub' : 'Подключить GitHub'}
                      </button>
                    ) : null}
                    {isGmailStub && !hasGmail ? (
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={actionsDisabled}
                        onClick={() => {
                          void onConnectGmailStub();
                        }}
                      >
                        Подключить Gmail (stub)
                      </button>
                    ) : null}
                    {!supportsOauth && !isGmailStub ? (
                      <button type="button" className="button-secondary" disabled>
                        Скоро
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Сводка по коннекторам</h2>
        <div className="stat-grid">
          <div className="stat-card">
            <span className="stat-card__label">Всего подключений</span>
            <strong>{connections.length}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-card__label">Подключено</span>
            <strong>{connectedCount}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-card__label">Нужно действие</span>
            <strong>{needsAttention.length}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-card__label">Режим</span>
            <strong>{actionsDisabled ? 'Локальный preview' : 'Живой API'}</strong>
          </div>
        </div>
        <p className="hint">
          {actionsDisabled
            ? 'В локальном preview список может быть синтетическим, а sync/OAuth потребуют живой API backend.'
            : 'GitHub OAuth и sync используют уже существующие endpoint-ы продукта. Gmail в текущем билде может оставаться заглушкой.'}
        </p>
      </section>

      <section className="panel">
        <h2>Состояние подключений</h2>
        {connections.length === 0 ? (
          <div className="surface-stack">
            <p className="hint">
              Подключений пока нет. Начните с GitHub OAuth или используйте Gmail stub, если он нужен
              для текущего демо-среза.
            </p>
          </div>
        ) : (
          <ul className="timeline" aria-label="Список подключений">
            {connections.map((connection, index) => {
              const connectorLabel = describeConnector(connection.connectorId);
              const supportsOAuth = connection.connectorId === 'github';
              const health = connection.id ? connectionHealth[connection.id] : undefined;
              const actionLabel =
                connection.status === 'reauth_required' || connection.status === 'revoked'
                  ? 'Авторизовать заново'
                  : 'Переподключить';
              return (
                <li
                  className="item"
                  key={`${connection.id ?? connection.connectorId ?? 'connection'}-${index}`}
                >
                  <div className="meta">
                    <span className="badge state">
                      {describeConnectionStatus(connection.status)}
                    </span>
                    <span>{connectorLabel}</span>
                    {connection.lastSyncAt ? <span>{formatTimestamp(connection.lastSyncAt)}</span> : null}
                  </div>
                  <h3>{connection.displayName ?? connectorLabel}</h3>
                  <p>{health?.note ?? describeConnectionMessage(connection)}</p>
                  {connection.scopes && connection.scopes.length > 0 ? (
                    <p className="hint">Scopes: {connection.scopes.join(', ')}</p>
                  ) : null}
                  {health ? (
                    <p className="hint">
                      Health: {health.status}
                      {health.checkedAt ? ` · ${formatTimestamp(health.checkedAt)}` : ''}
                    </p>
                  ) : null}
                  {connection.vaultRef ? (
                    <p className="hint">Vault ref: {connection.vaultRef}</p>
                  ) : null}
                  <div className="actions">
                    {connection.id ? (
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={actionsDisabled}
                        onClick={() => {
                          void onSyncConnections(connection.id);
                        }}
                      >
                        Синхронизировать
                      </button>
                    ) : null}
                    {supportsOAuth ? (
                      <button
                        type="button"
                        disabled={actionsDisabled}
                        onClick={() => {
                          void onStartOAuth({
                            connectorId: connection.connectorId,
                            displayName: connection.displayName ?? connectorLabel,
                            scopes:
                              connection.scopes && connection.scopes.length > 0
                                ? connection.scopes
                                : ['repositories.read'],
                          });
                        }}
                      >
                        {actionLabel}
                      </button>
                    ) : null}
                    {connection.id ? (
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={actionsDisabled}
                        onClick={() => {
                          void onRevokeConnection(connection.id!);
                        }}
                      >
                        Отозвать доступ
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
