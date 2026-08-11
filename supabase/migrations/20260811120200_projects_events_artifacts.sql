-- WP-02: projects, source events, artifacts (baseline §6.2–6.3)

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'archived')),
  aliases text[] NOT NULL DEFAULT '{}',
  repositories jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

-- FK from acl_entries.project_id added after projects exist
ALTER TABLE acl_entries
  ADD CONSTRAINT acl_entries_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE;

CREATE TABLE source_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects (id) ON DELETE SET NULL,
  connector_account_id uuid,
  provider text NOT NULL,
  event_type text NOT NULL,
  idempotency_key text NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  schema_version text NOT NULL DEFAULT '1.0',
  sensitivity text NOT NULL DEFAULT 'internal'
    CHECK (sensitivity IN ('public', 'internal', 'personal', 'confidential', 'restricted')),
  storage_mode text NOT NULL DEFAULT 'reference'
    CHECK (storage_mode IN ('reference', 'indexed', 'archived')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_checksum text,
  trace_id text,
  created_by_subject uuid REFERENCES subjects (id) ON DELETE SET NULL,
  UNIQUE (workspace_id, provider, idempotency_key)
);

CREATE TABLE artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects (id) ON DELETE SET NULL,
  source_event_id uuid REFERENCES source_events (id) ON DELETE SET NULL,
  mime_type text,
  storage_mode text NOT NULL DEFAULT 'reference'
    CHECK (storage_mode IN ('reference', 'indexed', 'archived')),
  storage_key text,
  checksum_sha256 text,
  byte_size bigint,
  version_label text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_workspace ON projects (workspace_id);
CREATE INDEX idx_source_events_workspace_recorded ON source_events (workspace_id, recorded_at DESC);
CREATE INDEX idx_source_events_project ON source_events (workspace_id, project_id);
CREATE INDEX idx_artifacts_workspace ON artifacts (workspace_id);
CREATE INDEX idx_artifacts_source_event ON artifacts (source_event_id);
