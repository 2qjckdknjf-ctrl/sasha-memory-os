ALTER TABLE processing_jobs
  DROP CONSTRAINT IF EXISTS processing_jobs_job_type_check;

ALTER TABLE processing_jobs
  ADD CONSTRAINT processing_jobs_job_type_check
  CHECK (job_type IN (
    'parse',
    'ocr',
    'embed',
    'extract',
    'consolidate',
    'ingest',
    'connector_sync',
    'roma_project_health'
  ));

CREATE OR REPLACE FUNCTION app.api_enqueue_roma_project_health(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_roma_subject constant uuid := '33333333-3333-4333-8333-333333333304';
  v_job_id uuid;
  v_event_id uuid;
  v_inserted boolean;
  v_project_exists boolean;
  v_reason text := coalesce(
    nullif(btrim(p_reason), ''),
    'Generate an audited ROMA project-health summary for one explicit project.'
  );
  v_idem text := format(
    'roma-project-health/%s/%s',
    p_project_id::text,
    coalesce(
      nullif(btrim(p_idempotency_key), ''),
      to_char(timezone('utc', now()), 'YYYYMMDDHH24MI')
    )
  );
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required';
  END IF;

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM projects p
    WHERE p.id = p_project_id
      AND p.workspace_id = p_workspace_id
  ) INTO v_project_exists;

  IF NOT v_project_exists THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.has_acl(p_workspace_id, 'project', 'read', p_project_id, 'internal') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM acl_entries a
    WHERE a.workspace_id = p_workspace_id
      AND a.subject_id = v_roma_subject
      AND a.effect = 'allow'
      AND a.resource_type = 'project'
      AND a.project_id = p_project_id
      AND (a.actions = '{}' OR 'read' = ANY (a.actions))
      AND (
        a.sensitivity_max IS NULL
        OR app.sensitivity_rank('internal') <= app.sensitivity_rank(a.sensitivity_max)
      )
  ) THEN
    RAISE EXCEPTION 'roma project access required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM acl_entries a
    WHERE a.workspace_id = p_workspace_id
      AND a.subject_id = v_roma_subject
      AND a.effect = 'allow'
      AND a.resource_type = 'memory'
      AND a.project_id = p_project_id
      AND (a.actions = '{}' OR 'write' = ANY (a.actions))
      AND (
        a.sensitivity_max IS NULL
        OR app.sensitivity_rank('internal') <= app.sensitivity_rank(a.sensitivity_max)
      )
  ) THEN
    RAISE EXCEPTION 'roma memory write access required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO processing_jobs (
    workspace_id,
    job_type,
    status,
    idempotency_key
  )
  VALUES (
    p_workspace_id,
    'roma_project_health',
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
      AND job_type = 'roma_project_health'
      AND idempotency_key = v_idem;

    SELECT o.id INTO v_event_id
    FROM outbox_events o
    WHERE o.workspace_id = p_workspace_id
      AND o.event_type = 'roma.project_health.requested'
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
      'roma.project_health.requested',
      jsonb_build_object(
        'jobId', v_job_id,
        'workspaceId', p_workspace_id,
        'projectId', p_project_id,
        'requestedBy', p_subject_id,
        'executionSubjectId', v_roma_subject,
        'reason', v_reason,
        'idempotencyKey', v_idem
      )
    )
    RETURNING id INTO v_event_id;
  END IF;

  RETURN jsonb_build_object(
    'jobId', v_job_id,
    'eventId', v_event_id,
    'workspaceId', p_workspace_id,
    'projectId', p_project_id,
    'requestedBy', p_subject_id,
    'executionSubjectId', v_roma_subject,
    'reason', v_reason,
    'idempotencyKey', v_idem,
    'inserted', v_inserted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_enqueue_roma_project_health(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_enqueue_roma_project_health(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_project_id,
    p_idempotency_key,
    p_reason
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_enqueue_roma_project_health(text, uuid, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_enqueue_roma_project_health(text, uuid, uuid, uuid, text, text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.api_claim_roma_project_health_jobs(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_limit integer DEFAULT 10,
  p_project_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_roma_subject constant uuid := '33333333-3333-4333-8333-333333333304';
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_jobs jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_subject_id <> v_roma_subject THEN
    RAISE EXCEPTION 'roma subject required' USING ERRCODE = '42501';
  END IF;

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH eligible AS (
    SELECT
      j.id,
      j.workspace_id,
      j.attempt,
      j.error,
      j.idempotency_key,
      requested.event_id,
      requested.project_id,
      requested.requested_by,
      requested.reason
    FROM processing_jobs j
    JOIN LATERAL (
      SELECT
        o.id AS event_id,
        (o.payload->>'projectId')::uuid AS project_id,
        (o.payload->>'requestedBy')::uuid AS requested_by,
        nullif(o.payload->>'reason', '') AS reason
      FROM outbox_events o
      WHERE o.workspace_id = j.workspace_id
        AND o.event_type = 'roma.project_health.requested'
        AND o.payload->>'jobId' = j.id::text
      ORDER BY o.created_at DESC
      LIMIT 1
    ) requested ON true
    WHERE j.workspace_id = p_workspace_id
      AND j.job_type = 'roma_project_health'
      AND j.status = 'queued'
      AND requested.project_id IS NOT NULL
      AND (p_project_id IS NULL OR requested.project_id = p_project_id)
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
      e.event_id,
      e.project_id,
      e.requested_by,
      e.reason
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
        'requestEventId', c.event_id,
        'projectId', c.project_id,
        'requestedBy', c.requested_by,
        'reason', c.reason
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

CREATE OR REPLACE FUNCTION public.api_claim_roma_project_health_jobs(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_limit integer DEFAULT 10,
  p_project_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_claim_roma_project_health_jobs(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_limit,
    p_project_id
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_claim_roma_project_health_jobs(text, uuid, uuid, integer, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_claim_roma_project_health_jobs(text, uuid, uuid, integer, uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.api_complete_roma_project_health(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid,
  p_status text DEFAULT 'succeeded',
  p_error text DEFAULT NULL,
  p_memory_id uuid DEFAULT NULL,
  p_audit_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_roma_subject constant uuid := '33333333-3333-4333-8333-333333333304';
  v_job processing_jobs%ROWTYPE;
  v_event_id uuid;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_subject_id <> v_roma_subject THEN
    RAISE EXCEPTION 'roma subject required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job
  FROM processing_jobs
  WHERE id = p_job_id
    AND job_type = 'roma_project_health'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'roma project health job not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member(v_job.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('succeeded', 'failed', 'dead_letter') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  UPDATE processing_jobs
  SET
    status = p_status,
    error = p_error,
    updated_at = now()
  WHERE id = p_job_id;

  INSERT INTO outbox_events (
    workspace_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload
  )
  SELECT
    v_job.workspace_id,
    'processing_job',
    v_job.id,
    'roma.project_health.completed',
    jsonb_strip_nulls(jsonb_build_object(
      'jobId', v_job.id,
      'workspaceId', v_job.workspace_id,
      'status', p_status,
      'memoryId', p_memory_id,
      'auditEventId', p_audit_event_id,
      'error', p_error
    ))
  WHERE NOT EXISTS (
    SELECT 1
    FROM outbox_events o
    WHERE o.aggregate_id = v_job.id
      AND o.event_type = 'roma.project_health.completed'
      AND o.payload->>'status' = p_status
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'jobId', v_job.id,
    'status', p_status,
    'jobType', v_job.job_type,
    'error', p_error,
    'memoryId', p_memory_id,
    'auditEventId', p_audit_event_id,
    'eventId', v_event_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_complete_roma_project_health(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid,
  p_status text DEFAULT 'succeeded',
  p_error text DEFAULT NULL,
  p_memory_id uuid DEFAULT NULL,
  p_audit_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_complete_roma_project_health(
    p_secret,
    p_subject_id,
    p_job_id,
    p_status,
    p_error,
    p_memory_id,
    p_audit_event_id
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_complete_roma_project_health(text, uuid, uuid, text, text, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_complete_roma_project_health(text, uuid, uuid, text, text, uuid, uuid)
  TO anon, authenticated, service_role;
