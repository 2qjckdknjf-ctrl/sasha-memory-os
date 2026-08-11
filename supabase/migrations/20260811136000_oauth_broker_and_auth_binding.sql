-- OAuth broker control-plane (vault refs only) + Supabase Auth → subject binding

CREATE TABLE connector_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  connector_account_id uuid NOT NULL UNIQUE REFERENCES connector_accounts (id) ON DELETE CASCADE,
  vault_ref text NOT NULL,
  key_purpose text NOT NULL DEFAULT 'oauth_refresh'
    CHECK (key_purpose IN ('oauth_refresh', 'oauth_access', 'webhook', 'api_key')),
  rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  connector_id text NOT NULL REFERENCES connector_definitions (id),
  connector_account_id uuid REFERENCES connector_accounts (id) ON DELETE SET NULL,
  state text NOT NULL UNIQUE,
  redirect_uri text,
  scopes text[] NOT NULL DEFAULT '{}',
  created_by_subject uuid REFERENCES subjects (id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_oauth_states_expires ON oauth_states (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE connector_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_secrets FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_states FORCE ROW LEVEL SECURITY;

CREATE POLICY connector_secrets_select ON connector_secrets
  FOR SELECT USING (app.is_workspace_member(workspace_id));

CREATE POLICY connector_secrets_write ON connector_secrets
  FOR ALL USING (app.is_workspace_member(workspace_id))
  WITH CHECK (app.is_workspace_member(workspace_id));

CREATE POLICY oauth_states_select ON oauth_states
  FOR SELECT USING (app.is_workspace_member(workspace_id));

CREATE POLICY oauth_states_write ON oauth_states
  FOR ALL USING (app.is_workspace_member(workspace_id))
  WITH CHECK (app.is_workspace_member(workspace_id));

CREATE OR REPLACE FUNCTION app.api_oauth_start(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_connector_id text,
  p_display_name text,
  p_scopes text[] DEFAULT '{}',
  p_redirect_uri text DEFAULT NULL,
  p_authorize_base text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_account_id uuid;
  v_state text := encode(gen_random_bytes(24), 'hex');
  v_state_id uuid;
  v_authorize text;
  v_scopes text[] := coalesce(p_scopes, '{}');
  v_scope_q text := replace(array_to_string(v_scopes, ' '), ' ', '%20');
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM connector_definitions WHERE id = p_connector_id) THEN
    RAISE EXCEPTION 'unknown connector: %', p_connector_id;
  END IF;

  INSERT INTO connector_accounts (
    workspace_id, connector_id, display_name, status, scopes, metadata, updated_at
  ) VALUES (
    p_workspace_id,
    p_connector_id,
    p_display_name,
    'reauth_required',
    v_scopes,
    jsonb_build_object('oauth', 'pending', 'broker', 'stub'),
    now()
  )
  ON CONFLICT (workspace_id, connector_id, display_name) DO UPDATE
  SET
    status = 'reauth_required',
    scopes = EXCLUDED.scopes,
    updated_at = now(),
    metadata = coalesce(connector_accounts.metadata, '{}'::jsonb)
      || jsonb_build_object('oauth', 'pending', 'broker', 'stub')
  RETURNING id INTO v_account_id;

  INSERT INTO oauth_states (
    workspace_id, connector_id, connector_account_id, state, redirect_uri,
    scopes, created_by_subject, expires_at, metadata
  ) VALUES (
    p_workspace_id,
    p_connector_id,
    v_account_id,
    v_state,
    p_redirect_uri,
    v_scopes,
    p_subject_id,
    now() + interval '15 minutes',
    jsonb_build_object('display_name', p_display_name)
  )
  RETURNING id INTO v_state_id;

  IF p_authorize_base IS NOT NULL AND btrim(p_authorize_base) <> '' THEN
    v_authorize := format(
      '%s%sstate=%s&scope=%s',
      p_authorize_base,
      CASE WHEN position('?' in p_authorize_base) > 0 THEN '&' ELSE '?' END,
      v_state,
      v_scope_q
    );
  ELSE
    v_authorize := format(
      'stub://oauth/%s?state=%s&account=%s',
      p_connector_id,
      v_state,
      v_account_id
    );
  END IF;

  INSERT INTO audit_log (
    workspace_id, actor_subject_id, action, object_type, object_id, after_state
  ) VALUES (
    p_workspace_id, p_subject_id, 'oauth.start', 'oauth_state', v_state_id,
    jsonb_build_object(
      'connector_id', p_connector_id,
      'connector_account_id', v_account_id,
      'stub', p_authorize_base IS NULL
    )
  );

  RETURN jsonb_build_object(
    'state', v_state,
    'stateId', v_state_id,
    'connectionId', v_account_id,
    'authorizeUrl', v_authorize,
    'expiresAt', now() + interval '15 minutes'
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.api_oauth_complete_stub(
  p_secret text,
  p_subject_id uuid,
  p_state text,
  p_code text DEFAULT NULL,
  p_env text DEFAULT 'local'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_state oauth_states%ROWTYPE;
  v_vault text;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT * INTO v_state
  FROM oauth_states
  WHERE state = p_state
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oauth state not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_state.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'oauth state already consumed';
  END IF;

  IF v_state.expires_at < now() THEN
    RAISE EXCEPTION 'oauth state expired';
  END IF;

  IF NOT app.is_workspace_member(v_state.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Never persist authorization codes or tokens — vault reference only.
  v_vault := format(
    'vault:%s/connectors/%s/%s',
    coalesce(nullif(btrim(p_env), ''), 'local'),
    v_state.connector_id,
    v_state.connector_account_id
  );

  INSERT INTO connector_secrets (
    workspace_id, connector_account_id, vault_ref, key_purpose, rotated_at, updated_at
  ) VALUES (
    v_state.workspace_id,
    v_state.connector_account_id,
    v_vault,
    'oauth_refresh',
    now(),
    now()
  )
  ON CONFLICT (connector_account_id) DO UPDATE
  SET
    vault_ref = EXCLUDED.vault_ref,
    rotated_at = now(),
    updated_at = now();

  UPDATE connector_accounts
  SET
    status = 'connected',
    last_error = NULL,
    last_sync_at = now(),
    updated_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'oauth', 'connected_stub',
      'vault_ref', v_vault,
      'code_received', p_code IS NOT NULL AND btrim(p_code) <> ''
    )
  WHERE id = v_state.connector_account_id;

  UPDATE oauth_states
  SET consumed_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('completed', true)
  WHERE id = v_state.id;

  INSERT INTO audit_log (
    workspace_id, actor_subject_id, action, object_type, object_id, after_state
  ) VALUES (
    v_state.workspace_id,
    p_subject_id,
    'oauth.complete_stub',
    'connector_account',
    v_state.connector_account_id,
    jsonb_build_object('vault_ref', v_vault, 'token_persisted', false)
  );

  RETURN jsonb_build_object(
    'connectionId', v_state.connector_account_id,
    'connectorId', v_state.connector_id,
    'status', 'connected',
    'vaultRef', v_vault,
    'tokenPersisted', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.api_bind_auth_user(
  p_secret text,
  p_workspace_id uuid,
  p_auth_user_id uuid,
  p_email text DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_acting_subject_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_user_id uuid;
  v_subject_id uuid;
  v_name text := coalesce(
    nullif(btrim(p_display_name), ''),
    nullif(split_part(coalesce(p_email, 'user'), '@', 1), ''),
    'User'
  );
BEGIN
  PERFORM app.assert_api_secret(p_secret);

  IF p_acting_subject_id IS NOT NULL THEN
    PERFORM app.with_subject(p_acting_subject_id);
    IF NOT app.is_workspace_member(p_workspace_id) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO users (auth_user_id, email, display_name)
  VALUES (p_auth_user_id, p_email, v_name)
  ON CONFLICT (auth_user_id) DO UPDATE
  SET
    email = coalesce(EXCLUDED.email, users.email),
    display_name = CASE
      WHEN p_display_name IS NOT NULL AND btrim(p_display_name) <> '' THEN EXCLUDED.display_name
      ELSE users.display_name
    END,
    updated_at = now()
  RETURNING id INTO v_user_id;

  SELECT id INTO v_subject_id
  FROM subjects
  WHERE workspace_id = p_workspace_id
    AND user_id = v_user_id
    AND kind = 'user'
  LIMIT 1;

  IF v_subject_id IS NULL THEN
    INSERT INTO subjects (
      workspace_id, kind, user_id, external_key, display_name, metadata
    ) VALUES (
      p_workspace_id,
      'user',
      v_user_id,
      'auth:' || p_auth_user_id::text,
      v_name,
      jsonb_build_object('auth_user_id', p_auth_user_id)
    )
    RETURNING id INTO v_subject_id;
  ELSE
    UPDATE subjects
    SET
      display_name = v_name,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('auth_user_id', p_auth_user_id)
    WHERE id = v_subject_id;
  END IF;

  INSERT INTO workspace_memberships (workspace_id, user_id, subject_id, role)
  VALUES (p_workspace_id, v_user_id, v_subject_id, 'member')
  ON CONFLICT (workspace_id, user_id) DO UPDATE
  SET subject_id = EXCLUDED.subject_id;

  RETURN jsonb_build_object(
    'userId', v_user_id,
    'subjectId', v_subject_id,
    'authUserId', p_auth_user_id,
    'workspaceId', p_workspace_id,
    'displayName', v_name,
    'email', p_email
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.api_resolve_subject(
  p_secret text,
  p_workspace_id uuid,
  p_subject_id uuid DEFAULT NULL,
  p_actor_key text DEFAULT NULL,
  p_client_id text DEFAULT NULL,
  p_auth_user_id uuid DEFAULT NULL
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
  ELSIF p_auth_user_id IS NOT NULL THEN
    SELECT s.* INTO v_row
    FROM users u
    JOIN subjects s ON s.user_id = u.id AND s.workspace_id = p_workspace_id AND s.kind = 'user'
    WHERE u.auth_user_id = p_auth_user_id
    LIMIT 1;
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

  IF v_row.id IS NULL THEN
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

CREATE OR REPLACE FUNCTION public.api_oauth_start(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_connector_id text,
  p_display_name text,
  p_scopes text[] DEFAULT '{}',
  p_redirect_uri text DEFAULT NULL,
  p_authorize_base text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_oauth_start(
    p_secret, p_subject_id, p_workspace_id, p_connector_id,
    p_display_name, p_scopes, p_redirect_uri, p_authorize_base
  );
$$;

CREATE OR REPLACE FUNCTION public.api_oauth_complete_stub(
  p_secret text,
  p_subject_id uuid,
  p_state text,
  p_code text DEFAULT NULL,
  p_env text DEFAULT 'local'
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_oauth_complete_stub(
    p_secret, p_subject_id, p_state, p_code, p_env
  );
$$;

CREATE OR REPLACE FUNCTION public.api_bind_auth_user(
  p_secret text,
  p_workspace_id uuid,
  p_auth_user_id uuid,
  p_email text DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_acting_subject_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_bind_auth_user(
    p_secret, p_workspace_id, p_auth_user_id, p_email, p_display_name, p_acting_subject_id
  );
$$;

-- Replace resolve wrappers for auth_user_id signature
DROP FUNCTION IF EXISTS app.api_resolve_subject(text, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.api_resolve_subject(text, uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.api_resolve_subject(
  p_secret text,
  p_workspace_id uuid,
  p_subject_id uuid DEFAULT NULL,
  p_actor_key text DEFAULT NULL,
  p_client_id text DEFAULT NULL,
  p_auth_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_resolve_subject(
    p_secret, p_workspace_id, p_subject_id, p_actor_key, p_client_id, p_auth_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_oauth_start(text, uuid, uuid, text, text, text[], text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_oauth_start(text, uuid, uuid, text, text, text[], text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_oauth_complete_stub(text, uuid, text, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_oauth_complete_stub(text, uuid, text, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_bind_auth_user(text, uuid, uuid, text, text, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_bind_auth_user(text, uuid, uuid, text, text, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_resolve_subject(text, uuid, uuid, text, text, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_resolve_subject(text, uuid, uuid, text, text, uuid)
  TO anon, authenticated, service_role;
