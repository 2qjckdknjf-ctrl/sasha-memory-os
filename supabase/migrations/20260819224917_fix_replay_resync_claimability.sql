-- Fix replay/resync cursor resets and restore replayed accounts to a claimable state.

CREATE OR REPLACE FUNCTION app.api_replay_connector_sync(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid,
  p_resync boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_job processing_jobs%ROWTYPE;
  v_connection connector_accounts%ROWTYPE;
  v_connection_id uuid;
  v_cleared integer := 0;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT * INTO v_job
  FROM processing_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member(v_job.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_job.job_type <> 'connector_sync' THEN
    RAISE EXCEPTION 'job is not connector_sync';
  END IF;

  IF v_job.status <> 'dead_letter' THEN
    RAISE EXCEPTION 'connector_sync replay requires a dead_letter job';
  END IF;

  SELECT (payload->>'connectionId')::uuid INTO v_connection_id
  FROM outbox_events
  WHERE workspace_id = v_job.workspace_id
    AND event_type = 'connector.sync.requested'
    AND payload->>'jobId' = v_job.id::text
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_connection_id IS NULL AND v_job.idempotency_key LIKE 'connector-sync/%' THEN
    v_connection_id := split_part(v_job.idempotency_key, '/', 2)::uuid;
  END IF;

  IF v_connection_id IS NULL THEN
    RAISE EXCEPTION 'connector_sync replay requires a connection id';
  END IF;

  SELECT * INTO v_connection
  FROM connector_accounts
  WHERE id = v_connection_id
    AND workspace_id = v_job.workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_connection.status IN ('revoked', 'disabled') THEN
    RAISE EXCEPTION 'connection is not eligible for replay';
  END IF;

  IF p_resync THEN
    DELETE FROM connector_cursors
    WHERE account_id = v_connection_id;
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
  END IF;

  UPDATE processing_jobs
  SET
    status = 'queued',
    error = NULL,
    updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  UPDATE connector_accounts
  SET
    last_error = NULL,
    status = CASE
      WHEN status = 'revoked' THEN 'revoked'
      WHEN status = 'disabled' THEN 'disabled'
      ELSE 'connected'
    END,
    updated_at = now()
  WHERE id = v_connection_id
    AND workspace_id = v_job.workspace_id;

  INSERT INTO audit_log (
    workspace_id,
    actor_subject_id,
    action,
    object_type,
    object_id,
    after_state
  ) VALUES (
    v_job.workspace_id,
    p_subject_id,
    'connection.sync.replayed',
    'connector_account',
    v_connection_id,
    jsonb_build_object(
      'jobId', v_job.id,
      'connectionId', v_connection_id,
      'resync', p_resync,
      'clearedCursorCount', v_cleared
    )
  );

  RETURN jsonb_build_object(
    'jobId', v_job.id,
    'status', v_job.status,
    'attempt', v_job.attempt,
    'connectionId', v_connection_id,
    'jobType', v_job.job_type,
    'resync', p_resync,
    'clearedCursorCount', v_cleared
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_replay_connector_sync(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid,
  p_resync boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_replay_connector_sync(
    p_secret,
    p_subject_id,
    p_job_id,
    p_resync
  );
$$;

CREATE OR REPLACE FUNCTION app.api_resync_connector(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_connection_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_connection connector_accounts%ROWTYPE;
  v_job_id uuid;
  v_event_id uuid;
  v_cleared integer := 0;
  v_vault_ref text;
  v_idem text;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_connection
  FROM connector_accounts
  WHERE workspace_id = p_workspace_id
    AND id = p_connection_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_connection.status IN ('revoked', 'disabled') THEN
    RAISE EXCEPTION 'connection is not eligible for resync';
  END IF;

  DELETE FROM connector_cursors
  WHERE account_id = p_connection_id;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  SELECT cs.vault_ref INTO v_vault_ref
  FROM connector_secrets cs
  WHERE cs.connector_account_id = p_connection_id
    AND cs.workspace_id = p_workspace_id
    AND cs.key_purpose IN ('oauth_access', 'oauth_refresh')
  ORDER BY cs.updated_at DESC NULLS LAST
  LIMIT 1;

  v_idem := format('connector-sync/%s/resync/%s', p_connection_id::text, gen_random_uuid()::text);

  INSERT INTO processing_jobs (
    workspace_id,
    job_type,
    status,
    idempotency_key
  ) VALUES (
    p_workspace_id,
    'connector_sync',
    'queued',
    v_idem
  ) RETURNING id INTO v_job_id;

  INSERT INTO outbox_events (
    workspace_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload
  ) VALUES (
    p_workspace_id,
    'connector_account',
    p_connection_id,
    'connector.sync.requested',
    jsonb_build_object(
      'connectionId', p_connection_id,
      'connectorId', v_connection.connector_id,
      'displayName', v_connection.display_name,
      'requestedBy', p_subject_id,
      'vaultRef', v_vault_ref,
      'jobId', v_job_id,
      'idempotencyKey', v_idem,
      'mode', CASE WHEN v_vault_ref IS NULL THEN 'stub' ELSE 'vault' END,
      'resync', true
    )
  ) RETURNING id INTO v_event_id;

  INSERT INTO audit_log (
    workspace_id,
    actor_subject_id,
    action,
    object_type,
    object_id,
    after_state
  ) VALUES (
    p_workspace_id,
    p_subject_id,
    'connection.sync.resync_requested',
    'connector_account',
    p_connection_id,
    jsonb_build_object(
      'connectionId', p_connection_id,
      'connectorId', v_connection.connector_id,
      'jobId', v_job_id,
      'eventId', v_event_id,
      'clearedCursorCount', v_cleared,
      'idempotencyKey', v_idem
    )
  );

  UPDATE connector_accounts
  SET
    last_error = NULL,
    status = CASE
      WHEN status = 'revoked' THEN 'revoked'
      WHEN status = 'disabled' THEN 'disabled'
      ELSE 'connected'
    END,
    updated_at = now()
  WHERE id = p_connection_id
    AND workspace_id = p_workspace_id;

  RETURN jsonb_build_object(
    'jobId', v_job_id,
    'eventId', v_event_id,
    'connectionId', p_connection_id,
    'connectorId', v_connection.connector_id,
    'clearedCursorCount', v_cleared,
    'idempotencyKey', v_idem
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_resync_connector(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_connection_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_resync_connector(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_connection_id
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_replay_connector_sync(text, uuid, uuid, boolean)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_replay_connector_sync(text, uuid, uuid, boolean)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_resync_connector(text, uuid, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_resync_connector(text, uuid, uuid, uuid)
  TO anon, authenticated, service_role;
