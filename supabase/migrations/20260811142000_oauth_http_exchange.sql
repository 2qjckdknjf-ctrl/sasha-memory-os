-- Peek OAuth state before HTTP exchange; allow exchange_mode = exchanged

CREATE OR REPLACE FUNCTION app.api_oauth_peek_state(
  p_secret text,
  p_subject_id uuid,
  p_state text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_state oauth_states%ROWTYPE;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT * INTO v_state
  FROM oauth_states
  WHERE state = p_state;

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

  RETURN jsonb_build_object(
    'state', v_state.state,
    'workspaceId', v_state.workspace_id,
    'connectorId', v_state.connector_id,
    'connectionId', v_state.connector_account_id,
    'redirectUri', v_state.redirect_uri,
    'scopes', to_jsonb(v_state.scopes),
    'expiresAt', v_state.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_oauth_peek_state(
  p_secret text,
  p_subject_id uuid,
  p_state text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_oauth_peek_state(p_secret, p_subject_id, p_state);
$$;

DROP FUNCTION IF EXISTS public.api_oauth_complete_stub(text, uuid, text, text, text, text, text);
DROP FUNCTION IF EXISTS app.api_oauth_complete_stub(text, uuid, text, text, text, text, text);

CREATE OR REPLACE FUNCTION app.api_oauth_complete_stub(
  p_secret text,
  p_subject_id uuid,
  p_state text,
  p_code text DEFAULT NULL,
  p_env text DEFAULT 'local',
  p_exchange_mode text DEFAULT 'stub',
  p_code_fingerprint text DEFAULT NULL
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
  v_mode text := coalesce(nullif(btrim(p_exchange_mode), ''), 'stub');
  v_oauth_label text;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF v_mode NOT IN ('stub', 'credentials_ready', 'exchanged') THEN
    RAISE EXCEPTION 'invalid exchange mode: %', v_mode;
  END IF;

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

  v_oauth_label := CASE v_mode
    WHEN 'exchanged' THEN 'connected'
    WHEN 'credentials_ready' THEN 'connected_credentials_ready'
    ELSE 'connected_stub'
  END;

  UPDATE connector_accounts
  SET
    status = 'connected',
    last_error = NULL,
    last_sync_at = now(),
    updated_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'oauth', v_oauth_label,
      'vault_ref', v_vault,
      'exchange_mode', v_mode,
      'code_fingerprint', p_code_fingerprint,
      'code_received', p_code_fingerprint IS NOT NULL,
      'tokens_in_vault', v_mode = 'exchanged'
    )
  WHERE id = v_state.connector_account_id;

  UPDATE oauth_states
  SET consumed_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'completed', true,
        'exchange_mode', v_mode,
        'code_fingerprint', p_code_fingerprint
      )
  WHERE id = v_state.id;

  INSERT INTO audit_log (
    workspace_id, actor_subject_id, action, object_type, object_id, after_state
  ) VALUES (
    v_state.workspace_id,
    p_subject_id,
    CASE WHEN v_mode = 'exchanged' THEN 'oauth.complete' ELSE 'oauth.complete_stub' END,
    'connector_account',
    v_state.connector_account_id,
    jsonb_build_object(
      'vault_ref', v_vault,
      'token_persisted', false,
      'exchange_mode', v_mode,
      'code_fingerprint', p_code_fingerprint,
      'tokens_in_vault', v_mode = 'exchanged'
    )
  );

  RETURN jsonb_build_object(
    'connectionId', v_state.connector_account_id,
    'connectorId', v_state.connector_id,
    'status', 'connected',
    'vaultRef', v_vault,
    'tokenPersisted', false,
    'exchangeMode', v_mode,
    'codeFingerprint', p_code_fingerprint,
    'tokensInVault', v_mode = 'exchanged'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_oauth_complete_stub(
  p_secret text,
  p_subject_id uuid,
  p_state text,
  p_code text DEFAULT NULL,
  p_env text DEFAULT 'local',
  p_exchange_mode text DEFAULT 'stub',
  p_code_fingerprint text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_oauth_complete_stub(
    p_secret, p_subject_id, p_state, p_code, p_env, p_exchange_mode, p_code_fingerprint
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_oauth_peek_state(text, uuid, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_oauth_peek_state(text, uuid, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_oauth_complete_stub(text, uuid, text, text, text, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_oauth_complete_stub(text, uuid, text, text, text, text, text)
  TO anon, authenticated, service_role;
