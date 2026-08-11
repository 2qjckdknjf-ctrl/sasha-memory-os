-- Enqueue consolidation jobs via outbox (cron / worker tick)

CREATE OR REPLACE FUNCTION app.api_enqueue_consolidation(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_job_id uuid;
  v_event_id uuid;
  v_idem text;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_idem := format(
    'consolidate/%s/%s',
    p_workspace_id::text,
    to_char(timezone('utc', now()), 'YYYYMMDDHH24MI')
  );

  INSERT INTO processing_jobs (
    workspace_id,
    job_type,
    status,
    idempotency_key
  )
  VALUES (
    p_workspace_id,
    'consolidate',
    'queued',
    v_idem
  )
  ON CONFLICT (workspace_id, job_type, idempotency_key) DO UPDATE
  SET updated_at = now()
  RETURNING id INTO v_job_id;

  INSERT INTO outbox_events (
    workspace_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload
  )
  VALUES (
    p_workspace_id,
    'workspace',
    p_workspace_id,
    'memory.consolidation.requested',
    jsonb_build_object(
      'jobId', v_job_id,
      'workspaceId', p_workspace_id,
      'subjectId', p_subject_id,
      'idempotencyKey', v_idem
    )
  )
  RETURNING id INTO v_event_id;

  UPDATE outbox_events
  SET attempts = attempts + 1
  WHERE id = v_event_id;

  UPDATE processing_jobs
  SET status = 'running', updated_at = now()
  WHERE id = v_job_id
    AND status = 'queued';

  RETURN jsonb_build_object(
    'jobId', v_job_id,
    'eventId', v_event_id,
    'idempotencyKey', v_idem,
    'workspaceId', p_workspace_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_enqueue_consolidation(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_enqueue_consolidation(p_secret, p_subject_id, p_workspace_id)
$$;

GRANT EXECUTE ON FUNCTION app.api_enqueue_consolidation(text, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_enqueue_consolidation(text, uuid, uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.api_complete_consolidation(
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

  IF v_job.job_type <> 'consolidate' THEN
    RAISE EXCEPTION 'job is not consolidate';
  END IF;

  UPDATE processing_jobs
  SET
    status = v_status,
    error = CASE WHEN v_status = 'succeeded' THEN NULL ELSE coalesce(p_error, error) END,
    updated_at = now(),
    attempt = attempt + 1
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  UPDATE outbox_events
  SET published_at = coalesce(published_at, now())
  WHERE workspace_id = v_job.workspace_id
    AND event_type = 'memory.consolidation.requested'
    AND payload->>'jobId' = v_job.id::text
    AND published_at IS NULL;

  RETURN jsonb_build_object(
    'jobId', v_job.id,
    'status', v_job.status,
    'jobType', v_job.job_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_complete_consolidation(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid,
  p_status text DEFAULT 'succeeded',
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_complete_consolidation(
    p_secret, p_subject_id, p_job_id, p_status, p_error
  )
$$;

GRANT EXECUTE ON FUNCTION app.api_complete_consolidation(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_complete_consolidation(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
