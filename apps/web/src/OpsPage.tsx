import type { ReactNode } from 'react';
import { ACTOR_LABELS, type Actor, type BackendMode, type ConnectionRecord, type ExtractionCandidate, type OutboxPendingItem, type ReviewQueueItem, type SearchContext, type SearchHit } from './controlCenter';

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
  onExportMemories: () => void | Promise<void>;
  onDeadLetterJobs: () => void | Promise<void>;
  onAckOutbox: (id: string) => void | Promise<void>;
  onUpdateConnectionStatus: (
    id: string,
    status: 'reauth_required' | 'revoked' | 'connected',
    lastError: string | null,
  ) => void | Promise<void>;
};

const actorOptions: Actor[] = ['owner', 'chatgpt', 'cursor', 'roma'];

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
  onExportMemories,
  onDeadLetterJobs,
  onAckOutbox,
  onUpdateConnectionStatus,
}: Props) {
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
        <h2>Сеанс разработчика</h2>
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

            {extractionPreview ? <p className="meta">{extractionPreview}</p> : null}
            {lastCapture ? <p className="meta">{lastCapture}</p> : null}

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
                    <p>{candidate.content.slice(0, 240)}</p>
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
            {jobLookup ? (
              <pre className="preformatted">{JSON.stringify(jobLookup, null, 2)}</pre>
            ) : null}
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
                <pre className="preformatted">{searchContext.text}</pre>
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
                <p>{hit.memory?.content ?? ''}</p>
                {hit.memory?.id ? (
                  <div className="actions">
                    <button
                      type="button"
                      onClick={() => {
                        void onSetHitStatus(hit.memory!.id!, 'verified');
                      }}
                    >
                      Approve
                    </button>
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
                          text: hit.memory?.content,
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
                void onBulkReviewStatus('verified');
              }}
            >
              Approve all
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
                <p>{item.content}</p>
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
                void onExportMemories();
              }}
            >
              Export memories JSON
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
                <p>{connection.lastError ?? 'No sync errors reported.'}</p>
                {connection.vaultRef ? <p className="meta">vault {connection.vaultRef}</p> : null}
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
                        void onUpdateConnectionStatus(connection.id!, 'revoked', null);
                      }}
                    >
                      Revoke
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
