-- Idempotent consolidation enqueue: one outbox row per minute-bucket job

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
  v_inserted boolean;
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
  ON CONFLICT (workspace_id, job_type, idempotency_key) DO NOTHING
  RETURNING id INTO v_job_id;

  v_inserted := v_job_id IS NOT NULL;

  IF NOT v_inserted THEN
    SELECT id INTO v_job_id
    FROM processing_jobs
    WHERE workspace_id = p_workspace_id
      AND job_type = 'consolidate'
      AND idempotency_key = v_idem;

    SELECT o.id INTO v_event_id
    FROM outbox_events o
    WHERE o.workspace_id = p_workspace_id
      AND o.event_type = 'memory.consolidation.requested'
      AND o.payload->>'idempotencyKey' = v_idem
    ORDER BY o.created_at DESC
    LIMIT 1;
  ELSE
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
  END IF;

  UPDATE processing_jobs
  SET status = 'running', updated_at = now()
  WHERE id = v_job_id
    AND status = 'queued';

  RETURN jsonb_build_object(
    'jobId', v_job_id,
    'eventId', v_event_id,
    'idempotencyKey', v_idem,
    'workspaceId', p_workspace_id,
    'inserted', v_inserted
  );
END;
$$;
