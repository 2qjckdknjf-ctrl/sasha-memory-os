-- WP-02: identity and access (baseline §6.1)

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  region text NOT NULL DEFAULT 'eu',
  retention_days integer,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE,
  email text,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('user', 'agent', 'service', 'connector')),
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  external_key text NOT NULL,
  display_name text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind, external_key)
);

CREATE TABLE agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  subject_id uuid NOT NULL UNIQUE REFERENCES subjects (id) ON DELETE CASCADE,
  client_key text NOT NULL,
  version text,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  trust_level text NOT NULL DEFAULT 'standard'
    CHECK (trust_level IN ('low', 'standard', 'high')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, client_key)
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  UNIQUE (workspace_id, name)
);

CREATE TABLE role_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_id, role_id)
);

CREATE TABLE acl_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  effect text NOT NULL CHECK (effect IN ('allow', 'deny')),
  resource_type text NOT NULL,
  resource_id uuid,
  project_id uuid,
  actions text[] NOT NULL DEFAULT '{}',
  sensitivity_max text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  client_id text NOT NULL,
  audience text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, client_id)
);

CREATE TABLE workspace_memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX idx_subjects_workspace ON subjects (workspace_id);
CREATE INDEX idx_acl_workspace_subject ON acl_entries (workspace_id, subject_id);
