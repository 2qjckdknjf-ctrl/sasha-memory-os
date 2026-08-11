-- WP-02/05 foundation: typed memory for demo slice (baseline §5.3, §6.2)

CREATE TABLE memory_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects (id) ON DELETE SET NULL,
  memory_type text NOT NULL
    CHECK (memory_type IN (
      'fact', 'preference', 'idea', 'decision', 'task', 'event', 'state', 'handoff'
    )),
  title text NOT NULL,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN (
      'candidate', 'active', 'verified', 'disputed', 'superseded', 'retracted', 'deleted'
    )),
  importance numeric(4, 3) NOT NULL DEFAULT 0.5
    CHECK (importance >= 0 AND importance <= 1),
  confidence numeric(4, 3) NOT NULL DEFAULT 0.5
    CHECK (confidence >= 0 AND confidence <= 1),
  sensitivity text NOT NULL DEFAULT 'internal'
    CHECK (sensitivity IN ('public', 'internal', 'personal', 'confidential', 'restricted')),
  valid_from timestamptz,
  valid_to timestamptz,
  observed_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid REFERENCES memory_records (id),
  source_event_id uuid REFERENCES source_events (id) ON DELETE SET NULL,
  created_by_subject uuid REFERENCES subjects (id) ON DELETE SET NULL,
  schema_version text NOT NULL DEFAULT '1.0',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT memory_records_valid_interval CHECK (
    valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from
  ),
  CONSTRAINT memory_records_no_self_supersede CHECK (
    superseded_by IS NULL OR superseded_by <> id
  )
);

CREATE TABLE decisions (
  memory_id uuid PRIMARY KEY REFERENCES memory_records (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  rationale text,
  alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_maker text,
  effective_at timestamptz
);

CREATE TABLE tasks (
  memory_id uuid PRIMARY KEY REFERENCES memory_records (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  owner_subject_id uuid REFERENCES subjects (id) ON DELETE SET NULL,
  task_status text NOT NULL DEFAULT 'open'
    CHECK (task_status IN ('open', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_at timestamptz,
  dependencies uuid[] NOT NULL DEFAULT '{}'
);

CREATE TABLE project_state_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  version integer NOT NULL,
  state jsonb NOT NULL,
  summary text,
  created_by_subject uuid REFERENCES subjects (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE TABLE handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  memory_id uuid REFERENCES memory_records (id) ON DELETE SET NULL,
  from_subject_id uuid REFERENCES subjects (id) ON DELETE SET NULL,
  to_subject_id uuid REFERENCES subjects (id) ON DELETE SET NULL,
  session_id uuid,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memory_evidence (
  memory_id uuid NOT NULL REFERENCES memory_records (id) ON DELETE CASCADE,
  source_event_id uuid NOT NULL REFERENCES source_events (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  evidence_span jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (memory_id, source_event_id)
);

CREATE TABLE memory_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  memory_id uuid NOT NULL REFERENCES memory_records (id) ON DELETE CASCADE,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  reason text,
  created_by_subject uuid REFERENCES subjects (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (memory_id, revision)
);

CREATE INDEX idx_memory_workspace_type_status
  ON memory_records (workspace_id, memory_type, status);
CREATE INDEX idx_memory_project_current
  ON memory_records (workspace_id, project_id, status)
  WHERE status IN ('active', 'verified');
CREATE INDEX idx_project_state_latest
  ON project_state_versions (project_id, version DESC);
CREATE INDEX idx_handoffs_project_created
  ON handoffs (project_id, created_at DESC);
