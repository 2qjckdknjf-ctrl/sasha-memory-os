-- M13 Slice 03: project-scoped proactive consolidation enqueue on the existing job/outbox path.

CREATE OR REPLACE FUNCTION app.api_enqueue_project_consolidation(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_reason text DEFAULT NULL
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

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required';
  END IF;

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT app.has_acl(p_workspace_id, 'memory', 'read', p_project_id, 'internal') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'owner subject required for proactive consolidation';
  END IF;

  v_idem := format(
    'consolidate/%s/%s/%s',
    p_workspace_id::text,
    p_project_id::text,
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
      'project',
      p_project_id,
      'memory.consolidation.requested',
      jsonb_build_object(
        'jobId', v_job_id,
        'workspaceId', p_workspace_id,
        'projectId', p_project_id,
        'subjectId', p_subject_id,
        'idempotencyKey', v_idem,
        'mode', 'proactive',
        'reason', nullif(btrim(coalesce(p_reason, '')), '')
      )
    )
    RETURNING id INTO v_event_id;
  END IF;

  UPDATE processing_jobs
  SET status = 'running', updated_at = now()
  WHERE id = v_job_id
    AND status = 'queued';

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'jobId', v_job_id,
    'eventId', v_event_id,
    'idempotencyKey', v_idem,
    'workspaceId', p_workspace_id,
    'projectId', p_project_id,
    'mode', 'proactive',
    'inserted', v_inserted
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.api_enqueue_project_consolidation(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_enqueue_project_consolidation(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_project_id,
    p_reason
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_enqueue_project_consolidation(text, uuid, uuid, uuid, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_enqueue_project_consolidation(text, uuid, uuid, uuid, text)
  TO anon, authenticated, service_role;
