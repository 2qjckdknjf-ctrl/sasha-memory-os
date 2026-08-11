-- WP-02/03: sessions, audit, outbox, processing jobs (baseline §6.5)

CREATE TABLE agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects (id) ON DELETE SET NULL,
  subject_id uuid NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  client_key text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'finished', 'abandoned')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE handoffs
  ADD CONSTRAINT handoffs_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES agent_sessions (id) ON DELETE SET NULL;

CREATE TABLE session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES agent_sessions (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  actor_subject_id uuid REFERENCES subjects (id) ON DELETE SET NULL,
  client_key text,
  action text NOT NULL,
  object_type text,
  object_id uuid,
  policy_decision text,
  reason text,
  trace_id text,
  before_state jsonb,
  after_state jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  actor_subject_id uuid REFERENCES subjects (id) ON DELETE SET NULL,
  action text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('allow', 'deny', 'error')),
  policy_decision text,
  object_type text,
  object_id uuid,
  trace_id text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE TABLE processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  job_type text NOT NULL
    CHECK (job_type IN (
      'parse', 'ocr', 'embed', 'extract', 'consolidate', 'ingest'
    )),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'running', 'succeeded', 'failed', 'dead_letter'
    )),
  source_event_id uuid REFERENCES source_events (id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, job_type, idempotency_key)
);

CREATE INDEX idx_audit_workspace_recorded ON audit_log (workspace_id, recorded_at DESC);
CREATE INDEX idx_access_workspace_recorded ON access_log (workspace_id, recorded_at DESC);
CREATE INDEX idx_outbox_unpublished ON outbox_events (created_at)
  WHERE published_at IS NULL;
CREATE INDEX idx_processing_jobs_status ON processing_jobs (workspace_id, status);
