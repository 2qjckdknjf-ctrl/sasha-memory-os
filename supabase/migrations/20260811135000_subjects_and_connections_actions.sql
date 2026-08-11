-- Subject resolution by UUID / external_key / api client_id
-- Connection connect / revoke / reauth control-plane stubs (no real OAuth yet)

CREATE OR REPLACE FUNCTION app.api_resolve_subject(
  p_secret text,
  p_workspace_id uuid,
  p_subject_id uuid DEFAULT NULL,
  p_actor_key text DEFAULT NULL,
  p_client_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_row subjects%ROWTYPE;
BEGIN
  PERFORM app.assert_api_secret(p_secret);

  IF p_subject_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM subjects
    WHERE id = p_subject_id AND workspace_id = p_workspace_id;
  ELSIF p_client_id IS NOT NULL AND btrim(p_client_id) <> '' THEN
    SELECT s.* INTO v_row
    FROM api_clients c
    JOIN subjects s ON s.id = c.subject_id
    WHERE c.workspace_id = p_workspace_id
      AND c.client_id = p_client_id;
  ELSIF p_actor_key IS NOT NULL AND btrim(p_actor_key) <> '' THEN
    SELECT * INTO v_row
    FROM subjects
    WHERE workspace_id = p_workspace_id
      AND external_key = p_actor_key
    ORDER BY kind
    LIMIT 1;
  END IF;

  IF NOT FOUND OR v_row.id IS NULL THEN
    RAISE EXCEPTION 'subject not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'workspaceId', v_row.workspace_id,
    'kind', v_row.kind,
    'externalKey', v_row.external_key,
    'displayName', v_row.display_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_resolve_subject(
  p_secret text,
  p_workspace_id uuid,
  p_subject_id uuid DEFAULT NULL,
  p_actor_key text DEFAULT NULL,
  p_client_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_resolve_subject(
    p_secret, p_workspace_id, p_subject_id, p_actor_key, p_client_id
  );
$$;

CREATE OR REPLACE FUNCTION app.api_upsert_connection(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_connector_id text,
  p_display_name text,
  p_scopes text[] DEFAULT '{}',
  p_status text DEFAULT 'connected'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_id uuid;
  v_status text := coalesce(nullif(btrim(p_status), ''), 'connected');
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM connector_definitions WHERE id = p_connector_id
  ) THEN
    RAISE EXCEPTION 'unknown connector: %', p_connector_id;
  END IF;

  IF v_status NOT IN ('connected', 'degraded', 'reauth_required', 'revoked', 'disabled') THEN
    RAISE EXCEPTION 'invalid status: %', v_status;
  END IF;

  INSERT INTO connector_accounts (
    workspace_id, connector_id, display_name, status, scopes, last_sync_at, metadata, updated_at
  ) VALUES (
    p_workspace_id,
    p_connector_id,
    p_display_name,
    v_status,
    coalesce(p_scopes, '{}'),
    CASE WHEN v_status = 'connected' THEN now() ELSE NULL END,
    jsonb_build_object('mode', 'stub', 'oauth', 'pending_real_broker'),
    now()
  )
  ON CONFLICT (workspace_id, connector_id, display_name) DO UPDATE
  SET
    status = EXCLUDED.status,
    scopes = EXCLUDED.scopes,
    last_sync_at = CASE
      WHEN EXCLUDED.status = 'connected' THEN now()
      ELSE connector_accounts.last_sync_at
    END,
    last_error = NULL,
    metadata = coalesce(connector_accounts.metadata, '{}'::jsonb)
      || jsonb_build_object('mode', 'stub', 'updated_by', p_subject_id),
    updated_at = now()
  RETURNING id INTO v_id;

  INSERT INTO audit_log (
    workspace_id, actor_subject_id, action, object_type, object_id, after_state
  ) VALUES (
    p_workspace_id,
    p_subject_id,
    'connection.upsert',
    'connector_account',
    v_id,
    jsonb_build_object(
      'connector_id', p_connector_id,
      'display_name', p_display_name,
      'status', v_status
    )
  );

  RETURN (
    SELECT jsonb_build_object(
      'id', a.id,
      'connectorId', a.connector_id,
      'displayName', a.display_name,
      'status', a.status,
      'scopes', a.scopes,
      'lastSyncAt', a.last_sync_at,
      'lastError', a.last_error
    )
    FROM connector_accounts a
    WHERE a.id = v_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_upsert_connection(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_connector_id text,
  p_display_name text,
  p_scopes text[] DEFAULT '{}',
  p_status text DEFAULT 'connected'
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_upsert_connection(
    p_secret, p_subject_id, p_workspace_id, p_connector_id,
    p_display_name, p_scopes, p_status
  );
$$;

CREATE OR REPLACE FUNCTION app.api_set_connection_status(
  p_secret text,
  p_subject_id uuid,
  p_connection_id uuid,
  p_status text,
  p_last_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_row connector_accounts%ROWTYPE;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT * INTO v_row FROM connector_accounts WHERE id = p_connection_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member(v_row.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('connected', 'degraded', 'reauth_required', 'revoked', 'disabled') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  UPDATE connector_accounts
  SET
    status = p_status,
    last_error = p_last_error,
    last_sync_at = CASE
      WHEN p_status = 'connected' THEN now()
      ELSE last_sync_at
    END,
    updated_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'status_set_by', p_subject_id,
      'status_set_at', now()
    )
  WHERE id = p_connection_id
  RETURNING * INTO v_row;

  INSERT INTO audit_log (
    workspace_id, actor_subject_id, action, object_type, object_id, after_state
  ) VALUES (
    v_row.workspace_id,
    p_subject_id,
    'connection.status',
    'connector_account',
    v_row.id,
    jsonb_build_object('status', p_status, 'last_error', p_last_error)
  );

  RETURN jsonb_build_object(
    'id', v_row.id,
    'connectorId', v_row.connector_id,
    'displayName', v_row.display_name,
    'status', v_row.status,
    'scopes', v_row.scopes,
    'lastSyncAt', v_row.last_sync_at,
    'lastError', v_row.last_error
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_set_connection_status(
  p_secret text,
  p_subject_id uuid,
  p_connection_id uuid,
  p_status text,
  p_last_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_set_connection_status(
    p_secret, p_subject_id, p_connection_id, p_status, p_last_error
  );
$$;

-- Demo API clients mapped to seed subjects (token/client_id stubs, not secrets)
INSERT INTO api_clients (workspace_id, subject_id, client_id, audience)
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333301',
    'demo-owner',
    ARRAY['memory-api', 'mcp']
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333302',
    'demo-chatgpt',
    ARRAY['memory-api', 'mcp']
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333303',
    'demo-cursor',
    ARRAY['memory-api', 'mcp']
  )
ON CONFLICT (workspace_id, client_id) DO NOTHING;

GRANT EXECUTE ON FUNCTION app.api_resolve_subject(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_resolve_subject(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_upsert_connection(text, uuid, uuid, text, text, text[], text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_upsert_connection(text, uuid, uuid, text, text, text[], text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_set_connection_status(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_set_connection_status(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
