-- Connector SDK registry slice: catalog, connection lookup, and persisted cursors

CREATE TABLE connector_cursors (
  account_id uuid NOT NULL REFERENCES connector_accounts (id) ON DELETE CASCADE,
  stream text NOT NULL,
  opaque_cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_version text NOT NULL DEFAULT '1.0',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, stream)
);

ALTER TABLE connector_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_cursors FORCE ROW LEVEL SECURITY;

CREATE POLICY connector_cursors_select ON connector_cursors
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM connector_accounts a
      WHERE a.id = connector_cursors.account_id
        AND app.is_workspace_member(a.workspace_id)
    )
  );

CREATE POLICY connector_cursors_write ON connector_cursors
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM connector_accounts a
      WHERE a.id = connector_cursors.account_id
        AND app.is_workspace_member(a.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM connector_accounts a
      WHERE a.id = connector_cursors.account_id
        AND app.is_workspace_member(a.workspace_id)
    )
  );

CREATE OR REPLACE FUNCTION app.api_list_connectors(
  p_secret text,
  p_subject_id uuid
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

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id,
      'version', d.version,
      'displayName', d.display_name,
      'authType', d.auth_type,
      'capabilities', d.capabilities,
      'supports', d.supports,
      'storageModes', d.storage_modes
    ) ORDER BY d.display_name, d.id)
    FROM connector_definitions d
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_list_connectors(
  p_secret text,
  p_subject_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_list_connectors(p_secret, p_subject_id);
$$;

CREATE OR REPLACE FUNCTION app.api_get_connection(
  p_secret text,
  p_subject_id uuid,
  p_connection_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_row jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT jsonb_build_object(
    'id', a.id,
    'workspaceId', a.workspace_id,
    'connectorId', a.connector_id,
    'displayName', a.display_name,
    'status', a.status,
    'scopes', a.scopes,
    'lastSyncAt', a.last_sync_at,
    'lastError', a.last_error,
    'vaultRef', s.vault_ref,
    'definition', jsonb_build_object(
      'id', d.id,
      'version', d.version,
      'displayName', d.display_name,
      'authType', d.auth_type,
      'capabilities', d.capabilities,
      'supports', d.supports,
      'storageModes', d.storage_modes
    )
  )
  INTO v_row
  FROM connector_accounts a
  JOIN connector_definitions d ON d.id = a.connector_id
  LEFT JOIN LATERAL (
    SELECT cs.vault_ref
    FROM connector_secrets cs
    WHERE cs.connector_account_id = a.id
      AND cs.workspace_id = a.workspace_id
      AND cs.key_purpose IN ('oauth_access', 'oauth_refresh')
    ORDER BY cs.updated_at DESC NULLS LAST
    LIMIT 1
  ) s ON true
  WHERE a.id = p_connection_id;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member((v_row->>'workspaceId')::uuid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.api_get_connection(
  p_secret text,
  p_subject_id uuid,
  p_connection_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_get_connection(p_secret, p_subject_id, p_connection_id);
$$;

CREATE OR REPLACE FUNCTION app.api_get_connector_cursor(
  p_secret text,
  p_subject_id uuid,
  p_account_id uuid,
  p_stream text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT workspace_id INTO v_workspace_id
  FROM connector_accounts
  WHERE id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'accountId', c.account_id,
      'stream', c.stream,
      'cursor', c.opaque_cursor,
      'schemaVersion', c.schema_version,
      'updatedAt', c.updated_at
    )
    FROM connector_cursors c
    WHERE c.account_id = p_account_id
      AND c.stream = p_stream
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_get_connector_cursor(
  p_secret text,
  p_subject_id uuid,
  p_account_id uuid,
  p_stream text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_get_connector_cursor(p_secret, p_subject_id, p_account_id, p_stream);
$$;

CREATE OR REPLACE FUNCTION app.api_upsert_connector_cursor(
  p_secret text,
  p_subject_id uuid,
  p_account_id uuid,
  p_stream text,
  p_cursor jsonb,
  p_schema_version text DEFAULT '1.0'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT workspace_id INTO v_workspace_id
  FROM connector_accounts
  WHERE id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO connector_cursors (
    account_id,
    stream,
    opaque_cursor,
    schema_version,
    updated_at
  ) VALUES (
    p_account_id,
    p_stream,
    coalesce(p_cursor, '{}'::jsonb),
    coalesce(nullif(btrim(p_schema_version), ''), '1.0'),
    now()
  )
  ON CONFLICT (account_id, stream) DO UPDATE
  SET
    opaque_cursor = EXCLUDED.opaque_cursor,
    schema_version = EXCLUDED.schema_version,
    updated_at = now();

  RETURN (
    SELECT jsonb_build_object(
      'accountId', c.account_id,
      'stream', c.stream,
      'cursor', c.opaque_cursor,
      'schemaVersion', c.schema_version,
      'updatedAt', c.updated_at
    )
    FROM connector_cursors c
    WHERE c.account_id = p_account_id
      AND c.stream = p_stream
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_upsert_connector_cursor(
  p_secret text,
  p_subject_id uuid,
  p_account_id uuid,
  p_stream text,
  p_cursor jsonb,
  p_schema_version text DEFAULT '1.0'
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_upsert_connector_cursor(
    p_secret,
    p_subject_id,
    p_account_id,
    p_stream,
    p_cursor,
    p_schema_version
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_list_connectors(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_list_connectors(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_get_connection(text, uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_get_connection(text, uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_get_connector_cursor(text, uuid, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_get_connector_cursor(text, uuid, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_upsert_connector_cursor(text, uuid, uuid, text, jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_upsert_connector_cursor(text, uuid, uuid, text, jsonb, text) TO anon, authenticated, service_role;

UPDATE connector_definitions
SET
  auth_type = 'oauth2',
  capabilities = '["repositories.read","pull_requests.read","issues.read"]'::jsonb,
  supports = '{"initial_sync":true,"incremental_sync":true,"webhooks":false,"live_fetch":true,"write":false}'::jsonb,
  storage_modes = ARRAY['reference', 'indexed']
WHERE id = 'github';
