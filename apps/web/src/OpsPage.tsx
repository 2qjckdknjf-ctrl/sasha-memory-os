import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { OFFICIAL_M14_SUPPORT_OPS_PACK } from '@memory-os/observability';
import { ACTOR_LABELS, type Actor, type BackendMode, type ConnectionRecord, type ExtractionCandidate, type OutboxPendingItem, type ReviewQueueItem, type SearchContext, type SearchHit } from './controlCenter';

const SUPPORT_OPS_REPOSITORY_BLOB_BASE =
  'https://github.com/2qjckdknjf-ctrl/sasha-memory-os/blob/main/';
const OPS_REDACTION_MESSAGE =
  'Redacted on /ops — use scoped pages, privacy, or runbooks instead of raw payloads.';
const SAFE_METADATA_STRING_KEYS = new Set([
  'action',
  'connectorId',
  'engine',
  'eventId',
  'id',
  'jobId',
  'kind',
  'label',
  'level',
  'memoryId',
  'mode',
  'name',
  'objectId',
  'objectType',
  'outcome',
  'ownerRole',
  'path',
  'projectId',
  'reason',
  'requestId',
  'route',
  'service',
  'status',
  'title',
  'toolName',
  'workspaceId',
]);
const OPS_SENSITIVE_FIELD_NAME_PATTERN =
  /(?:^|[_-])(token|secret|password|authorization|cookie|content|text|body|payload|query|prompt|context|memory|personal|email|subject|message|reason|correction|vault)(?:[_-]|$)/i;

type Props = {
  actor: Actor;
  backend: BackendMode;
  scopePanel: ReactNode;
  writeProjectName: string | null;
  search: string;
  packContext: boolean;
  searchContext: SearchContext | null;
  hits: SearchHit[];
  captureTitle: string;
  captureText: string;
  lastCapture: string | null;
  docTitle: string;
  docFileName: string | null;
  linkUrl: string;
  linkTitle: string;
  reviewQueue: ReviewQueueItem[];
  outboxPending: OutboxPendingItem[];
  jobLookupId: string;
  jobLookup: Record<string, unknown> | null;
  extractionPreview: string | null;
  extractionCandidates: ExtractionCandidate[];
  extractionSelected: Set<number>;
  connections: ConnectionRecord[];
  onActorChange: (actor: Actor) => void;
  onRefresh: () => void;
  onBumpState: () => void | Promise<void>;
  onSearchTermChange: (value: string) => void;
  onPackContextChange: (value: boolean) => void;
  onSearch: () => void | Promise<void>;
  onSetHitStatus: (
    memoryId: string,
    status: 'verified' | 'disputed' | 'retracted',
  ) => void | Promise<boolean>;
  onEmbedMemory: (
    memoryId: string,
    options?: { title?: string; text?: string },
  ) => void | Promise<void>;
  onCaptureTitleChange: (value: string) => void;
  onCaptureTextChange: (value: string) => void;
  onCaptureText: () => void | Promise<void>;
  onPreviewExtraction: () => void | Promise<void>;
  onApplyExtraction: () => void | Promise<void>;
  onToggleExtractionSelected: (index: number) => void;
  onDocTitleChange: (value: string) => void;
  onDocFileChange: (file: File | null) => void;
  onCaptureDocument: () => void | Promise<void>;
  onLinkUrlChange: (value: string) => void;
  onLinkTitleChange: (value: string) => void;
  onCaptureLink: () => void | Promise<void>;
  onRefreshReviewQueue: () => void | Promise<void>;
  onBulkReviewStatus: (
    status: 'verified' | 'disputed' | 'retracted',
  ) => void | Promise<void>;
  onRunConsolidation: () => void | Promise<void>;
  onEmbedMissing: () => void | Promise<void>;
  onJobLookupIdChange: (value: string) => void;
  onLoadJob: () => void | Promise<void>;
  onProcessJob: () => void | Promise<void>;
  onConnectGmailStub: () => void | Promise<void>;
  onStartOAuth: () => void | Promise<void>;
  onSyncConnections: () => void | Promise<void>;
  onLoadOutbox: () => void | Promise<void>;
  onDeadLetterJobs: () => void | Promise<void>;
  onAckOutbox: (id: string) => void | Promise<void>;
  onUpdateConnectionStatus: (
    id: string,
    status: 'reauth_required' | 'revoked' | 'connected',
    lastError: string | null,
  ) => void | Promise<void>;
};

const actorOptions: Actor[] = ['owner', 'chatgpt', 'cursor', 'roma'];

function toSupportDocHref(path: string): string {
  return `${SUPPORT_OPS_REPOSITORY_BLOB_BASE}${path}`;
}

function sanitizeOpsString(key: string, value: string): string {
  if (SAFE_METADATA_STRING_KEYS.has(key)) {
    return value;
  }
  return OPS_REDACTION_MESSAGE;
}

function sanitizeOpsValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return sanitizeOpsString(key, value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeOpsValue(key, item));
  }
  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      sanitized[childKey] = OPS_SENSITIVE_FIELD_NAME_PATTERN.test(childKey)
        ? OPS_REDACTION_MESSAGE
        : sanitizeOpsValue(childKey, childValue);
    }
    return sanitized;
  }
  return String(value);
}

function sanitizeOpsLookup(value: Record<string, unknown> | null): string | null {
  if (!value) return null;
  return JSON.stringify(sanitizeOpsValue('jobLookup', value), null, 2);
}

function describeConnectionNote(connection: ConnectionRecord): string {
  if (connection.lastError) {
    return 'Sync issue present — inspect the linked runbooks or audit trail, not raw connector payloads.';
  }
  return 'No sync errors reported.';
}

export function OpsPage({
  actor,
  backend,
  scopePanel,
  writeProjectName,
  search,
  packContext,
  searchContext,
  hits,
  captureTitle,
  captureText,
  lastCapture,
  docTitle,
  docFileName,
  linkUrl,
  linkTitle,
  reviewQueue,
  outboxPending,
  jobLookupId,
  jobLookup,
  extractionPreview,
  extractionCandidates,
  extractionSelected,
  connections,
  onActorChange,
  onRefresh,
  onBumpState,
  onSearchTermChange,
  onPackContextChange,
  onSearch,
  onSetHitStatus,
  onEmbedMemory,
  onCaptureTitleChange,
  onCaptureTextChange,
  onCaptureText,
  onPreviewExtraction,
  onApplyExtraction,
  onToggleExtractionSelected,
  onDocTitleChange,
  onDocFileChange,
  onCaptureDocument,
  onLinkUrlChange,
  onLinkTitleChange,
  onCaptureLink,
  onRefreshReviewQueue,
  onBulkReviewStatus,
  onRunConsolidation,
  onEmbedMissing,
  onJobLookupIdChange,
  onLoadJob,
  onProcessJob,
  onConnectGmailStub,
  onStartOAuth,
  onSyncConnections,
  onLoadOutbox,
  onDeadLetterJobs,
  onAckOutbox,
  onUpdateConnectionStatus,
}: Props) {
  const sanitizedJobLookup = sanitizeOpsLookup(jobLookup);

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Для разработчика</p>
        <h1>Ops и demo-инструменты</h1>
        <p className="lede">
          Служебная зона с impersonation, capture, outbox, jobs и другими текущими
          инженерными инструментами.
        </p>
      </header>

      {scopePanel}

      <section className="panel">
        <div className="meta">
          <span className="badge state">{OFFICIAL_M14_SUPPORT_OPS_PACK.version}</span>
          <span>{OFFICIAL_M14_SUPPORT_OPS_PACK.roadmapSections.join(' · ')}</span>
        </div>
        <h2>Official support / ops surface</h2>
        <p className="hint">
          This bounded pack makes <code>/ops</code> the official metadata-only support surface on
          the current Control Center. It reuses existing routes and checked-in docs instead of
          inventing a pager product or a parallel operations app.
        </p>
        <p className="hint">
          Actor switching below stays demo-only. It does not bypass owner tokens, ACL, or explicit{' '}
          <code>project_id</code> requirements.
        </p>

        <div className="stat-grid">
          <article className="stat-card">
            <span className="stat-card__label">SLO pack</span>
            <strong>{OFFICIAL_M14_SUPPORT_OPS_PACK.summary.sloTargetCount} targets</strong>
          </article>
          <article className="stat-card">
            <span className="stat-card__label">Runbooks</span>
            <strong>{OFFICIAL_M14_SUPPORT_OPS_PACK.summary.incidentRunbookCount} official docs</strong>
          </article>
          <article className="stat-card">
            <span className="stat-card__label">ChatGPT Mode A</span>
            <strong>{OFFICIAL_M14_SUPPORT_OPS_PACK.summary.modeAToolCount} tools</strong>
          </article>
        </div>

        <div className="grid surface-grid">
          <section className="panel">
            <h3>Ownership</h3>
            <ul className="surface-selector" aria-label="Support ownership">
              {OFFICIAL_M14_SUPPORT_OPS_PACK.ownership.map((area) => {
                const primaryLink = OFFICIAL_M14_SUPPORT_OPS_PACK.supportLinks.find(
                  (item) => item.id === area.primaryLinkId,
                );
                return (
                  <li key={area.id}>
                    <article className="surface-selector__button">
                      <span className="meta">
                        <span className="badge state">{area.ownerRole}</span>
                        <span>{primaryLink?.label ?? area.primaryLinkId}</span>
                      </span>
                      <strong>{area.id}</strong>
                      <p>{area.description}</p>
                    </article>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="panel">
            <h3>Official links</h3>
            <ul className="surface-selector" aria-label="Official support links">
              {OFFICIAL_M14_SUPPORT_OPS_PACK.supportLinks.map((item) => (
                <li key={item.id}>
                  <article className="surface-selector__button">
                    <span className="meta">
                      <span className="badge state">{item.ownerRole}</span>
                      <span>{item.kind === 'route' ? item.target : item.target}</span>
                    </span>
                    <strong>{item.label}</strong>
                    <p>{item.description}</p>
                    <div className="actions">
                      {item.kind === 'route' ? (
                        <Link to={item.target} className="button-link button-link--secondary">
                          Open {item.target}
                        </Link>
                      ) : (
                        <a
                          href={toSupportDocHref(item.target)}
                          target="_blank"
                          rel="noreferrer"
                          className="button-link button-link--secondary"
                        >
                          Open doc
                        </a>
                      )}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>

      <section className="panel">
        <h2>Demo-only developer session</h2>
        <div className="toolbar" role="group" aria-label="Actor">
          {actorOptions.map((key) => (
            <button
              key={key}
              type="button"
              data-active={actor === key}
              onClick={() => onActorChange(key)}
            >
              {ACTOR_LABELS[key]}
            </button>
          ))}
          <button
            type="button"
            disabled={!writeProjectName}
            onClick={() => {
              void onBumpState();
            }}
          >
            Bump state
          </button>
          <button type="button" onClick={onRefresh}>
            Refresh
          </button>
        </div>
        <p className="hint">Текущий backend: {backend}</p>
        <p className="hint">
          Demo-only actor switching lives here for validation and screenshots. It must never become
          an owner-token bypass.
        </p>
        {!writeProjectName ? (
          <p className="hint">
            Записывающие actions отключены, пока не выбран проект в фильтре выше.
          </p>
        ) : (
          <p className="hint">
            Записи из этой страницы будут адресованы проекту <strong>{writeProjectName}</strong>.
          </p>
        )}
      </section>

      <div className="grid">
        <section className="panel">
          <h2>Capture и extraction</h2>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void onCaptureText();
            }}
          >
            <label>
              Capture title
              <input
                value={captureTitle}
                onChange={(event) => onCaptureTitleChange(event.target.value)}
                required
              />
            </label>
            <label>
              Text note
              <textarea
                rows={3}
                value={captureText}
                onChange={(event) => onCaptureTextChange(event.target.value)}
                required
              />
            </label>
            <div className="actions">
              <button type="submit" disabled={!writeProjectName}>
                Capture text
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  void onPreviewExtraction();
                }}
              >
                Preview extraction
              </button>
              <button
                type="button"
                className="button-secondary"
                disabled={!writeProjectName}
                onClick={() => {
                  void onApplyExtraction();
                }}
              >
                Apply selected
              </button>
            </div>

            {extractionPreview ? <p className="meta">{OPS_REDACTION_MESSAGE}</p> : null}
            {lastCapture ? <p className="meta">{OPS_REDACTION_MESSAGE}</p> : null}

            {extractionCandidates.length > 0 ? (
              <ul className="timeline">
                {extractionCandidates.map((candidate, index) => (
                  <li className="item" key={`${candidate.title}-${index}`}>
                    <div className="meta">
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={extractionSelected.has(index)}
                          onChange={() => onToggleExtractionSelected(index)}
                        />
                        <span className="badge state">{candidate.memoryType ?? 'fact'}</span>
                      </label>
                      {typeof candidate.confidence === 'number' ? (
                        <span>conf {candidate.confidence.toFixed(2)}</span>
                      ) : null}
                    </div>
                    <h3>{candidate.title}</h3>
                    <p className="hint">{OPS_REDACTION_MESSAGE}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </form>
        </section>

        <section className="panel">
          <h2>Document и link capture</h2>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void onCaptureDocument();
            }}
          >
            <label>
              Document title
              <input
                value={docTitle}
                onChange={(event) => onDocTitleChange(event.target.value)}
                required
              />
            </label>
            <label>
              File (.txt / .pdf / .docx / audio)
              <input
                type="file"
                accept=".txt,.md,.pdf,.docx,.mp3,.wav,.m4a,.ogg,.webm,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,audio/*"
                onChange={(event) => onDocFileChange(event.target.files?.[0] ?? null)}
                required
              />
            </label>
            {docFileName ? <p className="meta">Selected: {docFileName}</p> : null}
            <button type="submit" disabled={!writeProjectName}>
              Capture document
            </button>
          </form>

          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void onCaptureLink();
            }}
          >
            <label>
              Link title
              <input
                value={linkTitle}
                onChange={(event) => onLinkTitleChange(event.target.value)}
                required
              />
            </label>
            <label>
              Public URL
              <input
                value={linkUrl}
                onChange={(event) => onLinkUrlChange(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={!writeProjectName}>
              Capture link
            </button>
          </form>
        </section>
      </div>

      <div className="grid">
        <section className="panel">
          <h2>Jobs</h2>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void onLoadJob();
            }}
          >
            <label>
              Job id
              <input
                value={jobLookupId}
                onChange={(event) => onJobLookupIdChange(event.target.value)}
                placeholder="from last capture"
              />
            </label>
            <div className="actions">
              <button type="submit">Load job status</button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  void onProcessJob();
                }}
              >
                Process job now
              </button>
            </div>
            {sanitizedJobLookup ? <pre className="preformatted">{sanitizedJobLookup}</pre> : null}
          </form>
        </section>

        <section className="panel">
          <h2>Search lab</h2>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void onSearch();
            }}
          >
            <label>
              Search
              <input value={search} onChange={(event) => onSearchTermChange(event.target.value)} />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={packContext}
                onChange={(event) => onPackContextChange(event.target.checked)}
              />
              <span>Pack context for agents</span>
            </label>
            <button type="submit">Search memories</button>

            {searchContext?.text ? (
              <div className="item item--plain">
                <div className="meta">
                  <span className="badge state">context</span>
                  <span>
                    packed {searchContext.packedCount ?? 0}
                    {searchContext.truncated ? ' · truncated' : ''}
                  </span>
                </div>
                <p className="hint">{OPS_REDACTION_MESSAGE}</p>
              </div>
            ) : null}
          </form>

          <ul className="timeline">
            {hits.map((hit, index) => (
              <li className="item" key={hit.memory?.id ?? `hit-${index}`}>
                <div className="meta">
                  <span className="badge state">{hit.memory?.status ?? 'unknown'}</span>
                  {hit.reason ? <span>{hit.reason}</span> : null}
                  {typeof hit.score === 'number' ? (
                    <span>score {hit.score.toFixed(4)}</span>
                  ) : null}
                </div>
                <h3>{hit.memory?.title ?? 'hit'}</h3>
                <p className="hint">{OPS_REDACTION_MESSAGE}</p>
                {hit.memory?.id ? (
                  <div className="actions">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => {
                        void onSetHitStatus(hit.memory!.id!, 'disputed');
                      }}
                    >
                      Dispute
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => {
                        void onSetHitStatus(hit.memory!.id!, 'retracted');
                      }}
                    >
                      Retract
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => {
                        void onEmbedMemory(hit.memory!.id!, {
                          title: hit.memory?.title,
                        });
                      }}
                    >
                      Re-embed
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid">
        <section className="panel">
          <h2>Review queue</h2>
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                void onRefreshReviewQueue();
              }}
            >
              Load candidates
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                void onBulkReviewStatus('disputed');
              }}
            >
              Dispute all
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                void onRunConsolidation();
              }}
            >
              Run consolidation
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                void onEmbedMissing();
              }}
            >
              Embed missing
            </button>
          </div>

          <ul className="timeline">
            {reviewQueue.map((item) => (
              <li className="item" key={item.id}>
                <div className="meta">
                  <span className="badge state">{item.status}</span>
                </div>
                <h3>{item.title}</h3>
                <p className="hint">{OPS_REDACTION_MESSAGE}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>Connections и outbox</h2>
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                void onConnectGmailStub();
              }}
            >
              Connect Gmail stub
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                void onStartOAuth();
              }}
            >
              OAuth GitHub
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                void onSyncConnections();
              }}
            >
              Enqueue connector sync
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                void onLoadOutbox();
              }}
            >
              Load outbox
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                void onDeadLetterJobs();
              }}
            >
              Dead-letter stale jobs
            </button>
          </div>

          {outboxPending.length > 0 ? (
            <ul className="timeline">
              {outboxPending.map((event, index) => (
                <li className="item" key={event.id ?? `outbox-${index}`}>
                  <div className="meta">
                    <span className="badge state">outbox</span>
                    <span>attempts {event.attempts ?? 0}</span>
                  </div>
                  <h3>{event.eventType ?? 'event'}</h3>
                  <p>{event.createdAt ?? 'pending'}</p>
                  {event.id && backend !== 'local' ? (
                    <div className="actions">
                      <button
                        type="button"
                        onClick={() => {
                          void onAckOutbox(event.id!);
                        }}
                      >
                        Ack publish
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <ul className="timeline">
            {connections.map((connection, index) => (
              <li className="item" key={`${connection.id ?? connection.connectorId}-${index}`}>
                <div className="meta">
                  <span className="badge state">{connection.status ?? 'unknown'}</span>
                  <span>{connection.connectorId}</span>
                  {connection.lastSyncAt ? <span>sync {connection.lastSyncAt}</span> : null}
                </div>
                <h3>{connection.displayName ?? connection.connectorId}</h3>
                <p>{describeConnectionNote(connection)}</p>
                {connection.id && backend !== 'local' ? (
                  <div className="actions">
                    <button
                      type="button"
                      onClick={() => {
                        void onUpdateConnectionStatus(
                          connection.id!,
                          'reauth_required',
                          'Stub reauth requested from Web',
                        );
                      }}
                    >
                      Reauth
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => {
                        void onUpdateConnectionStatus(connection.id!, 'connected', null);
                      }}
                    >
                      Mark connected
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}
