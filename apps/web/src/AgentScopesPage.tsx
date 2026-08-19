import { Link } from 'react-router-dom';
import { AGENT_SCOPE_PREVIEWS, actorIdForPreview } from './agentScopes';
import { type BackendMode, type MeResponse } from './controlCenter';

type Props = {
  backend: BackendMode;
  me: MeResponse | null;
};

export function AgentScopesPage({ backend, me }: Props) {
  const currentActorName = me?.actor.displayName ?? 'Текущий актор';
  const currentActorKey = me?.actor.externalKey ?? 'unknown';
  const currentActorId = me?.actor.id ?? me?.subjectId ?? '—';

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Агенты</p>
        <h1>Агенты и права доступа</h1>
        <p className="lede">
          Отдельного API матрицы прав пока нет, поэтому этот экран честно показывает текущего
          актора через <code>/v1/me</code> и preview прав только для чтения из текущей
          seed/demo policy. Опасный switch actor остается на <code>/ops</code>.
        </p>
      </header>

      <div className="cta-row">
        <Link to="/connections" className="button-link">
          Открыть подключения
        </Link>
        <Link to="/" className="button-link button-link--secondary">
          На главную
        </Link>
      </div>

      <div className="grid surface-grid">
        <section className="panel">
          <h2>Текущий актор в продукте</h2>
          <p className="hint">
            Этот блок показывает, чьи права сейчас используются в продуктовом интерфейсе. Если API
            недоступен, Control Center падает обратно на локальный preview.
          </p>
          <dl className="memory-inspector__facts">
            <div className="memory-inspector__fact">
              <dt>Имя</dt>
              <dd>{currentActorName}</dd>
            </div>
            <div className="memory-inspector__fact">
              <dt>Ключ</dt>
              <dd>{currentActorKey}</dd>
            </div>
            <div className="memory-inspector__fact">
              <dt>Subject ID</dt>
              <dd>{currentActorId}</dd>
            </div>
            <div className="memory-inspector__fact">
              <dt>Роль</dt>
              <dd>{me?.isOwner ? 'owner' : me?.actor.kind ?? 'agent'}</dd>
            </div>
            <div className="memory-inspector__fact">
              <dt>Источник</dt>
              <dd>{backend === 'local' ? 'Локальный preview' : '/v1/me'}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2>Что пока не видно через API</h2>
          <ul className="surface-bullets">
            <li>Нет живого endpoint-а матрицы прав для всех агентов рабочей области.</li>
            <li>Нет write API продукта для изменения ACL или trust/scopes.</li>
            <li>ROMA не показывается, потому что в текущем API/seed его еще нет.</li>
          </ul>
        </section>
      </div>

      <section className="panel">
        <h2>Preview прав только для чтения</h2>
        <p className="hint">
          Это не редактор ACL. Ниже только то, что текущий билд уже знает о владельце, ChatGPT и
          Cursor из seed/demo policy и actor metadata.
        </p>
        <div className="stat-grid">
          {AGENT_SCOPE_PREVIEWS.map((preview) => {
            const isCurrentActor = me?.actor.id === actorIdForPreview(preview.actor);
            return (
              <article className="stat-card" key={preview.actor}>
                <div className="meta">
                  <span className="badge state">{preview.kind}</span>
                  {isCurrentActor ? <span>текущий актор</span> : null}
                </div>
                <strong>{preview.displayName}</strong>
                <p className="hint">{preview.note}</p>
                <p className="hint">Чувствительность: {preview.sensitivity}</p>
                <p className="section-subtitle">Права</p>
                <ul className="surface-bullets">
                  {preview.rights.map((right) => (
                    <li key={`${preview.actor}-${right.resource}`}>
                      <strong>{right.resource}:</strong> {right.access}
                    </li>
                  ))}
                </ul>
                <p className="section-subtitle">Capabilities / surface hints</p>
                <ul className="surface-bullets">
                  {preview.capabilities.map((capability) => (
                    <li key={`${preview.actor}-${capability}`}>
                      <code>{capability}</code>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}
