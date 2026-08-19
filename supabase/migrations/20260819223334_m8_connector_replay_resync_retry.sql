-- M8 connector platform: retryable connector_sync jobs, replay, and resync.

CREATE OR REPLACE FUNCTION app.api_complete_connector_sync(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid,
  p_status text DEFAULT 'succeeded',
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_job processing_jobs%ROWTYPE;
  v_connection_id uuid;
  v_status text := coalesce(nullif(btrim(p_status), ''), 'succeeded');
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF v_status NOT IN ('succeeded', 'failed', 'dead_letter') THEN
    RAISE EXCEPTION 'invalid status: %', v_status;
  END IF;

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

  UPDATE processing_jobs
  SET
    status = v_status,
    error = CASE WHEN v_status = 'succeeded' THEN NULL ELSE coalesce(p_error, error) END,
    updated_at = now(),
    attempt = attempt + 1
  WHERE id = v_job.id
  RETURNING * INTO v_job;

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

  IF v_connection_id IS NOT NULL AND v_status = 'succeeded' THEN
    UPDATE connector_accounts
    SET
      last_sync_at = now(),
      last_error = NULL,
      status = CASE
        WHEN status = 'revoked' THEN 'revoked'
        WHEN status = 'disabled' THEN 'disabled'
        ELSE 'connected'
      END,
      updated_at = now()
    WHERE id = v_connection_id
      AND workspace_id = v_job.workspace_id;
  ELSIF v_connection_id IS NOT NULL AND v_status <> 'succeeded' THEN
    UPDATE connector_accounts
    SET
      last_error = coalesce(p_error, 'connector sync failed'),
      status = CASE
        WHEN status = 'revoked' THEN 'revoked'
        WHEN status = 'disabled' THEN 'disabled'
        ELSE 'degraded'
      END,
      updated_at = now()
    WHERE id = v_connection_id
      AND workspace_id = v_job.workspace_id;
  END IF;

  UPDATE outbox_events
  SET published_at = coalesce(published_at, now())
  WHERE workspace_id = v_job.workspace_id
    AND event_type = 'connector.sync.requested'
    AND payload->>'jobId' = v_job.id::text
    AND published_at IS NULL;

  INSERT INTO audit_log (
    workspace_id,
    actor_subject_id,
    action,
    object_type,
    object_id,
    reason,
    after_state
  ) VALUES (
    v_job.workspace_id,
    p_subject_id,
    'connection.sync.completed',
    CASE WHEN v_connection_id IS NULL THEN 'connector_sync_job' ELSE 'connector_account' END,
    v_connection_id,
    CASE WHEN v_status = 'succeeded' THEN NULL ELSE coalesce(p_error, 'connector sync failed') END,
    jsonb_build_object(
      'jobId', v_job.id,
      'connectionId', v_connection_id,
      'status', v_status
    )
  );

  RETURN jsonb_build_object(
    'jobId', v_job.id,
    'status', v_job.status,
    'connectionId', v_connection_id,
    'jobType', v_job.job_type,
    'attempt', v_job.attempt
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_complete_connector_sync(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid,
  p_status text DEFAULT 'succeeded',
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_complete_connector_sync(
    p_secret, p_subject_id, p_job_id, p_status, p_error
  );
$$;

CREATE OR REPLACE FUNCTION app.api_claim_connector_sync_jobs(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_limit integer DEFAULT 20,
  p_connection_id uuid DEFAULT NULL,
  p_retry_base_ms integer DEFAULT 30000,
  p_retry_max_ms integer DEFAULT 300000
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  v_retry_base_ms integer := greatest(1000, coalesce(p_retry_base_ms, 30000));
  v_retry_max_ms integer := greatest(v_retry_base_ms, coalesce(p_retry_max_ms, 300000));
  v_jobs jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH eligible AS (
    SELECT
      j.id,
      j.workspace_id,
      j.idempotency_key,
      j.attempt,
      linked.connection_id,
      a.connector_id,
      a.display_name,
      v.vault_ref
    FROM processing_jobs j
    JOIN LATERAL (
      SELECT coalesce(
        (
          SELECT (o.payload->>'connectionId')::uuid
          FROM outbox_events o
          WHERE o.workspace_id = j.workspace_id
            AND o.event_type = 'connector.sync.requested'
            AND o.payload->>'jobId' = j.id::text
          ORDER BY o.created_at DESC
          LIMIT 1
        ),
        CASE
          WHEN j.idempotency_key LIKE 'connector-sync/%' THEN split_part(j.idempotency_key, '/', 2)::uuid
          ELSE NULL
        END
      ) AS connection_id
    ) linked ON true
    JOIN connector_accounts a
      ON a.id = linked.connection_id
     AND a.workspace_id = j.workspace_id
     AND a.status = 'connected'
    LEFT JOIN LATERAL (
      SELECT cs.vault_ref
      FROM connector_secrets cs
      WHERE cs.connector_account_id = a.id
        AND cs.workspace_id = a.workspace_id
        AND cs.key_purpose IN ('oauth_access', 'oauth_refresh')
      ORDER BY cs.updated_at DESC NULLS LAST
      LIMIT 1
    ) v ON true
    WHERE j.workspace_id = p_workspace_id
      AND j.job_type = 'connector_sync'
      AND j.status = 'queued'
      AND linked.connection_id IS NOT NULL
      AND (p_connection_id IS NULL OR linked.connection_id = p_connection_id)
      AND (
        j.attempt = 0
        OR j.updated_at <= now() - make_interval(
          secs => least(
            v_retry_max_ms::double precision / 1000.0,
            (v_retry_base_ms::double precision * power(2::double precision, greatest(j.attempt - 1, 0))) / 1000.0
          )
        )
      )
    ORDER BY j.updated_at ASC, j.created_at ASC
    LIMIT v_limit
    FOR UPDATE OF j SKIP LOCKED
  ),
  claimed AS (
    UPDATE processing_jobs j
    SET
      status = 'running',
      updated_at = now()
    FROM eligible e
    WHERE j.id = e.id
    RETURNING
      j.id,
      j.workspace_id,
      j.status,
      j.attempt,
      j.error,
      j.idempotency_key,
      e.connection_id,
      e.connector_id,
      e.display_name,
      e.vault_ref
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'jobId', c.id,
        'workspaceId', c.workspace_id,
        'status', c.status,
        'attempt', c.attempt,
        'error', c.error,
        'idempotencyKey', c.idempotency_key,
        'connectionId', c.connection_id,
        'connectorId', c.connector_id,
        'displayName', c.display_name,
        'vaultRef', c.vault_ref
      )
      ORDER BY c.id
    ),
    '[]'::jsonb
  ) INTO v_jobs
  FROM claimed c;

  RETURN jsonb_build_object(
    'count', jsonb_array_length(v_jobs),
    'jobs', v_jobs
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_claim_connector_sync_jobs(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_limit integer DEFAULT 20,
  p_connection_id uuid DEFAULT NULL,
  p_retry_base_ms integer DEFAULT 30000,
  p_retry_max_ms integer DEFAULT 300000
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_claim_connector_sync_jobs(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_limit,
    p_connection_id,
    p_retry_base_ms,
    p_retry_max_ms
  );
$$;

CREATE OR REPLACE FUNCTION app.api_retry_connector_sync(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_job processing_jobs%ROWTYPE;
  v_connection_id uuid;
  v_error text := coalesce(nullif(btrim(p_error), ''), 'retryable connector sync failure');
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

  UPDATE processing_jobs
  SET
    status = 'queued',
    error = v_error,
    updated_at = now(),
    attempt = attempt + 1
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  UPDATE outbox_events
  SET
    attempts = attempts + 1,
    last_error = v_error
  WHERE workspace_id = v_job.workspace_id
    AND event_type = 'connector.sync.requested'
    AND payload->>'jobId' = v_job.id::text;

  RETURN jsonb_build_object(
    'jobId', v_job.id,
    'status', v_job.status,
    'attempt', v_job.attempt,
    'connectionId', v_connection_id,
    'jobType', v_job.job_type,
    'error', v_job.error
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_retry_connector_sync(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_retry_connector_sync(
    p_secret,
    p_subject_id,
    p_job_id,
    p_error
  );
$$;

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

  IF p_resync AND v_connection_id IS NOT NULL THEN
    DELETE FROM connector_cursors
    WHERE workspace_id = v_job.workspace_id
      AND account_id = v_connection_id;
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
  END IF;

  UPDATE processing_jobs
  SET
    status = 'queued',
    error = NULL,
    updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

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
    CASE WHEN v_connection_id IS NULL THEN 'connector_sync_job' ELSE 'connector_account' END,
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
  WHERE workspace_id = p_workspace_id
    AND account_id = p_connection_id;
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

GRANT EXECUTE ON FUNCTION app.api_complete_connector_sync(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_complete_connector_sync(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_claim_connector_sync_jobs(text, uuid, uuid, integer, uuid, integer, integer)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_claim_connector_sync_jobs(text, uuid, uuid, integer, uuid, integer, integer)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_retry_connector_sync(text, uuid, uuid, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_retry_connector_sync(text, uuid, uuid, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_replay_connector_sync(text, uuid, uuid, boolean)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_replay_connector_sync(text, uuid, uuid, boolean)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_resync_connector(text, uuid, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_resync_connector(text, uuid, uuid, uuid)
  TO anon, authenticated, service_role;
