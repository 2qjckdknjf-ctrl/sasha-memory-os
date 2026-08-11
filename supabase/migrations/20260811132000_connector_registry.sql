-- Connector registry (baseline §6.4) — control-plane stubs for Connections UI

CREATE TABLE connector_definitions (
  id text PRIMARY KEY,
  version text NOT NULL DEFAULT '1.0.0',
  display_name text NOT NULL,
  auth_type text NOT NULL DEFAULT 'oauth2',
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  supports jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_modes text[] NOT NULL DEFAULT ARRAY['reference', 'indexed'],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE connector_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  connector_id text NOT NULL REFERENCES connector_definitions (id),
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'degraded', 'reauth_required', 'revoked', 'disabled')),
  scopes text[] NOT NULL DEFAULT '{}',
  last_sync_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, connector_id, display_name)
);

ALTER TABLE connector_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY connector_definitions_select ON connector_definitions
  FOR SELECT USING (true);

CREATE POLICY connector_accounts_select ON connector_accounts
  FOR SELECT USING (app.is_workspace_member(workspace_id));

CREATE POLICY connector_accounts_write ON connector_accounts
  FOR ALL USING (app.is_workspace_member(workspace_id))
  WITH CHECK (app.is_workspace_member(workspace_id));

CREATE OR REPLACE FUNCTION app.api_list_connections(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', a.id,
      'connectorId', a.connector_id,
      'displayName', a.display_name,
      'status', a.status,
      'scopes', a.scopes,
      'lastSyncAt', a.last_sync_at,
      'lastError', a.last_error,
      'definition', jsonb_build_object(
        'id', d.id,
        'displayName', d.display_name,
        'capabilities', d.capabilities
      )
    ) ORDER BY a.created_at)
    FROM connector_accounts a
    JOIN connector_definitions d ON d.id = a.connector_id
    WHERE a.workspace_id = p_workspace_id
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_list_connections(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_list_connections(p_secret, p_subject_id, p_workspace_id);
$$;

GRANT EXECUTE ON FUNCTION app.api_list_connections(text, uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_list_connections(text, uuid, uuid) TO anon, authenticated, service_role;

INSERT INTO connector_definitions (id, version, display_name, auth_type, capabilities, supports)
VALUES
  (
    'github',
    '1.0.0',
    'GitHub',
    'github_app',
    '["repositories.read","pull_requests.read","issues.read","events.webhook"]'::jsonb,
    '{"initial_sync":true,"incremental_sync":true,"webhooks":true,"write":false}'::jsonb
  ),
  (
    'google-drive',
    '1.0.0',
    'Google Drive',
    'oauth2',
    '["files.read","changes.list"]'::jsonb,
    '{"initial_sync":true,"incremental_sync":true,"write":false}'::jsonb
  ),
  (
    'gmail',
    '1.0.0',
    'Gmail',
    'oauth2',
    '["messages.metadata","labels.read"]'::jsonb,
    '{"initial_sync":true,"incremental_sync":true,"write":false}'::jsonb
  ),
  (
    'google-calendar',
    '1.0.0',
    'Google Calendar',
    'oauth2',
    '["events.read"]'::jsonb,
    '{"initial_sync":true,"incremental_sync":true,"write":false}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO connector_accounts (
  id, workspace_id, connector_id, display_name, status, scopes, last_sync_at, metadata
) VALUES
  (
    '88888888-8888-4888-8888-888888888801',
    '11111111-1111-4111-8111-111111111111',
    'github',
    'AISTROYKA repos',
    'connected',
    ARRAY['repositories.read', 'pull_requests.read'],
    now() - interval '15 minutes',
    '{"mode":"reference","repos":["aistroyka"]}'::jsonb
  ),
  (
    '88888888-8888-4888-8888-888888888802',
    '11111111-1111-4111-8111-111111111111',
    'google-drive',
    'Project docs',
    'degraded',
    ARRAY['drive.file'],
    now() - interval '2 days',
    '{"mode":"indexed","note":"reauth recommended"}'::jsonb
  )
ON CONFLICT (workspace_id, connector_id, display_name) DO NOTHING;
