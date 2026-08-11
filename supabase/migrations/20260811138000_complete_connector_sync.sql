-- Mark connector_sync jobs succeeded and bump connector_accounts.last_sync_at

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
      status = CASE WHEN status = 'connected' THEN status ELSE 'connected' END,
      updated_at = now()
    WHERE id = v_connection_id
      AND workspace_id = v_job.workspace_id;
  ELSIF v_connection_id IS NOT NULL AND v_status <> 'succeeded' THEN
    UPDATE connector_accounts
    SET
      last_error = coalesce(p_error, 'connector sync failed'),
      status = 'degraded',
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

  RETURN jsonb_build_object(
    'jobId', v_job.id,
    'status', v_job.status,
    'connectionId', v_connection_id,
    'jobType', v_job.job_type
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

GRANT EXECUTE ON FUNCTION app.api_complete_connector_sync(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_complete_connector_sync(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
