CREATE TABLE project_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  recipient_subject_id uuid NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  notification_type text NOT NULL
    CHECK (notification_type IN (
      'roma_project_health_completed',
      'roma_project_findings_completed'
    )),
  source_job_id uuid NOT NULL REFERENCES processing_jobs (id) ON DELETE CASCADE,
  source_job_type text NOT NULL
    CHECK (source_job_type IN (
      'roma_project_health',
      'roma_project_findings'
    )),
  source_memory_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  severity text NOT NULL
    CHECK (severity IN ('info', 'low', 'medium', 'high')),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread', 'acknowledged')),
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_subject uuid NOT NULL REFERENCES subjects (id),
  acknowledged_at timestamptz,
  acknowledged_by_subject uuid REFERENCES subjects (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, recipient_subject_id, idempotency_key)
);

CREATE INDEX project_notifications_recipient_idx
  ON project_notifications (recipient_subject_id, status, created_at DESC);

CREATE INDEX project_notifications_source_job_idx
  ON project_notifications (source_job_id, notification_type);

ALTER TABLE project_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY project_notifications_select
  ON project_notifications
  FOR SELECT
  USING (
    app.is_workspace_member(workspace_id)
    AND recipient_subject_id = app.current_subject_id()
    AND app.has_acl(workspace_id, 'project', 'read', project_id, 'internal')
  );

CREATE POLICY project_notifications_insert
  ON project_notifications
  FOR INSERT
  WITH CHECK (
    app.is_workspace_member(workspace_id)
    AND recipient_subject_id IS NOT NULL
    AND created_by_subject = app.current_subject_id()
    AND created_by_subject = '33333333-3333-4333-8333-333333333304'::uuid
    AND app.has_acl(workspace_id, 'project', 'read', project_id, 'internal')
  );

CREATE POLICY project_notifications_no_update
  ON project_notifications
  FOR UPDATE
  USING (false);

CREATE POLICY project_notifications_no_delete
  ON project_notifications
  FOR DELETE
  USING (false);

CREATE OR REPLACE FUNCTION app.create_project_notifications(
  p_workspace_id uuid,
  p_project_id uuid,
  p_notification_type text,
  p_source_job_id uuid,
  p_source_job_type text,
  p_title text,
  p_severity text,
  p_reason text DEFAULT NULL,
  p_source_memory_ids uuid[] DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_subject uuid := app.current_subject_id();
  v_title text := nullif(btrim(p_title), '');
  v_source_memory_ids uuid[] := ARRAY(
    SELECT DISTINCT entry
    FROM unnest(coalesce(p_source_memory_ids, '{}'::uuid[])) AS entry
    WHERE entry IS NOT NULL
    ORDER BY entry
  );
  v_idem text;
  v_notification_ids jsonb;
  v_outbox_ids jsonb;
  v_audit_ids jsonb;
  v_inserted_count integer;
BEGIN
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'subject required' USING ERRCODE = '42501';
  END IF;

  IF p_project_id IS NULL THEN
    RETURN jsonb_build_object(
      'notificationIds', '[]'::jsonb,
      'notificationEventIds', '[]'::jsonb,
      'notificationAuditEventIds', '[]'::jsonb,
      'notificationInsertedCount', 0
    );
  END IF;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'notification title required';
  END IF;

  IF p_notification_type NOT IN (
    'roma_project_health_completed',
    'roma_project_findings_completed'
  ) THEN
    RAISE EXCEPTION 'invalid notification type: %', p_notification_type;
  END IF;

  IF p_source_job_type NOT IN (
    'roma_project_health',
    'roma_project_findings'
  ) THEN
    RAISE EXCEPTION 'invalid source job type: %', p_source_job_type;
  END IF;

  IF p_severity NOT IN ('info', 'low', 'medium', 'high') THEN
    RAISE EXCEPTION 'invalid notification severity: %', p_severity;
  END IF;

  v_idem := format('roma-notification/%s/%s', p_notification_type, p_source_job_id::text);

  WITH recipients AS (
    SELECT DISTINCT wm.subject_id
    FROM workspace_memberships wm
    JOIN subjects s ON s.id = wm.subject_id
    WHERE wm.workspace_id = p_workspace_id
      AND wm.role = 'owner'
      AND s.workspace_id = p_workspace_id
  ),
  inserted AS (
    INSERT INTO project_notifications (
      workspace_id,
      project_id,
      recipient_subject_id,
      notification_type,
      source_job_id,
      source_job_type,
      source_memory_ids,
      severity,
      title,
      status,
      idempotency_key,
      metadata,
      created_by_subject
    )
    SELECT
      p_workspace_id,
      p_project_id,
      r.subject_id,
      p_notification_type,
      p_source_job_id,
      p_source_job_type,
      coalesce(v_source_memory_ids, '{}'::uuid[]),
      p_severity,
      v_title,
      'unread',
      v_idem,
      coalesce(p_metadata, '{}'::jsonb),
      v_subject
    FROM recipients r
    ON CONFLICT (workspace_id, recipient_subject_id, idempotency_key) DO NOTHING
    RETURNING
      id,
      recipient_subject_id,
      notification_type,
      source_job_id,
      source_job_type,
      source_memory_ids,
      severity,
      title,
      status,
      metadata
  ),
  inserted_audit AS (
    INSERT INTO audit_log (
      workspace_id,
      actor_subject_id,
      action,
      object_type,
      object_id,
      reason,
      after_state
    )
    SELECT
      p_workspace_id,
      v_subject,
      'project.notification.created',
      'project_notification',
      i.id,
      p_reason,
      jsonb_build_object(
        'notificationId', i.id,
        'projectId', p_project_id,
        'recipientSubjectId', i.recipient_subject_id,
        'notificationType', i.notification_type,
        'sourceJobId', i.source_job_id,
        'sourceJobType', i.source_job_type,
        'sourceMemoryIds', to_jsonb(i.source_memory_ids),
        'severity', i.severity,
        'title', i.title,
        'status', i.status,
        'metadata', i.metadata
      )
    FROM inserted i
    RETURNING id, object_id
  ),
  inserted_outbox AS (
    INSERT INTO outbox_events (
      workspace_id,
      aggregate_type,
      aggregate_id,
      event_type,
      payload
    )
    SELECT
      p_workspace_id,
      'project_notification',
      i.id,
      'project.notification.created',
      jsonb_build_object(
        'notificationId', i.id,
        'workspaceId', p_workspace_id,
        'projectId', p_project_id,
        'recipientSubjectId', i.recipient_subject_id,
        'notificationType', i.notification_type,
        'sourceJobId', i.source_job_id,
        'sourceJobType', i.source_job_type,
        'sourceMemoryIds', i.source_memory_ids,
        'severity', i.severity,
        'title', i.title,
        'status', i.status,
        'createdBySubject', v_subject,
        'auditEventId', a.id,
        'metadata', i.metadata
      )
    FROM inserted i
    LEFT JOIN inserted_audit a
      ON a.object_id = i.id
    RETURNING id
  )
  SELECT
    coalesce((
      SELECT jsonb_agg(n.id ORDER BY n.id)
      FROM project_notifications n
      WHERE n.workspace_id = p_workspace_id
        AND n.source_job_id = p_source_job_id
        AND n.notification_type = p_notification_type
    ), '[]'::jsonb),
    coalesce((
      SELECT jsonb_agg(o.id ORDER BY o.id)
      FROM inserted_outbox o
    ), '[]'::jsonb),
    coalesce((
      SELECT jsonb_agg(a.id ORDER BY a.id)
      FROM inserted_audit a
    ), '[]'::jsonb),
    coalesce((
      SELECT count(*)
      FROM inserted
    ), 0)
  INTO
    v_notification_ids,
    v_outbox_ids,
    v_audit_ids,
    v_inserted_count;

  RETURN jsonb_build_object(
    'notificationIds', v_notification_ids,
    'notificationEventIds', v_outbox_ids,
    'notificationAuditEventIds', v_audit_ids,
    'notificationInsertedCount', v_inserted_count
  );
END;
$$;

DROP FUNCTION IF EXISTS app.api_complete_roma_project_health(text, uuid, uuid, text, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.api_complete_roma_project_health(text, uuid, uuid, text, text, uuid, uuid);

CREATE OR REPLACE FUNCTION app.api_complete_roma_project_health(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid,
  p_status text DEFAULT 'succeeded',
  p_error text DEFAULT NULL,
  p_memory_id uuid DEFAULT NULL,
  p_audit_event_id uuid DEFAULT NULL,
  p_notification_title text DEFAULT NULL,
  p_notification_severity text DEFAULT 'info',
  p_notification_source_memory_ids uuid[] DEFAULT NULL,
  p_notification_metadata jsonb DEFAULT NULL
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
  v_status text := coalesce(nullif(btrim(p_status), ''), 'succeeded');
  v_event_id uuid;
  v_project_id uuid;
  v_request_event_id uuid;
  v_requested_by uuid;
  v_reason text;
  v_notification jsonb := jsonb_build_object(
    'notificationIds', '[]'::jsonb,
    'notificationEventIds', '[]'::jsonb,
    'notificationAuditEventIds', '[]'::jsonb,
    'notificationInsertedCount', 0
  );
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

  IF v_status NOT IN ('succeeded', 'failed', 'dead_letter') THEN
    RAISE EXCEPTION 'invalid status: %', v_status;
  END IF;

  SELECT
    o.id,
    (o.payload->>'projectId')::uuid,
    (o.payload->>'requestedBy')::uuid,
    nullif(o.payload->>'reason', '')
  INTO
    v_request_event_id,
    v_project_id,
    v_requested_by,
    v_reason
  FROM outbox_events o
  WHERE o.workspace_id = v_job.workspace_id
    AND o.event_type = 'roma.project_health.requested'
    AND o.payload->>'jobId' = v_job.id::text
  ORDER BY o.created_at DESC
  LIMIT 1;

  UPDATE processing_jobs
  SET
    status = v_status,
    error = CASE WHEN v_status = 'succeeded' THEN NULL ELSE coalesce(p_error, error) END,
    updated_at = now(),
    attempt = attempt + 1
  WHERE id = p_job_id;

  UPDATE outbox_events
  SET published_at = coalesce(published_at, now())
  WHERE workspace_id = v_job.workspace_id
    AND event_type = 'roma.project_health.requested'
    AND payload->>'jobId' = v_job.id::text
    AND published_at IS NULL;

  IF v_status = 'succeeded' AND v_project_id IS NOT NULL THEN
    PERFORM app.assert_roma_project_health_schedule_access(v_job.workspace_id, v_project_id);
    v_notification := app.create_project_notifications(
      v_job.workspace_id,
      v_project_id,
      'roma_project_health_completed',
      v_job.id,
      'roma_project_health',
      coalesce(
        nullif(btrim(p_notification_title), ''),
        'ROMA project health updated'
      ),
      coalesce(nullif(btrim(p_notification_severity), ''), 'info'),
      coalesce(v_reason, 'ROMA project health notification'),
      p_notification_source_memory_ids,
      coalesce(p_notification_metadata, '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
        'status', v_status,
        'requestEventId', v_request_event_id,
        'requestedBy', v_requested_by,
        'memoryId', p_memory_id,
        'auditEventId', p_audit_event_id
      ))
    );
  END IF;

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
      'status', v_status,
      'memoryId', p_memory_id,
      'auditEventId', p_audit_event_id,
      'notificationIds', v_notification->'notificationIds',
      'notificationInsertedCount', v_notification->'notificationInsertedCount',
      'error', p_error
    ))
  WHERE NOT EXISTS (
    SELECT 1
    FROM outbox_events o
    WHERE o.aggregate_id = v_job.id
      AND o.event_type = 'roma.project_health.completed'
      AND o.payload->>'status' = v_status
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'jobId', v_job.id,
    'status', v_status,
    'jobType', v_job.job_type,
    'error', p_error,
    'memoryId', p_memory_id,
    'auditEventId', p_audit_event_id,
    'eventId', v_event_id,
    'notificationIds', v_notification->'notificationIds',
    'notificationEventIds', v_notification->'notificationEventIds',
    'notificationAuditEventIds', v_notification->'notificationAuditEventIds',
    'notificationInsertedCount', v_notification->'notificationInsertedCount'
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
  p_audit_event_id uuid DEFAULT NULL,
  p_notification_title text DEFAULT NULL,
  p_notification_severity text DEFAULT 'info',
  p_notification_source_memory_ids uuid[] DEFAULT NULL,
  p_notification_metadata jsonb DEFAULT NULL
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
    p_audit_event_id,
    p_notification_title,
    p_notification_severity,
    p_notification_source_memory_ids,
    p_notification_metadata
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_complete_roma_project_health(
  text, uuid, uuid, text, text, uuid, uuid, text, text, uuid[], jsonb
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_complete_roma_project_health(
  text, uuid, uuid, text, text, uuid, uuid, text, text, uuid[], jsonb
) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS app.api_complete_roma_project_findings(text, uuid, uuid, text, text, uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.api_complete_roma_project_findings(text, uuid, uuid, text, text, uuid, uuid, integer);

CREATE OR REPLACE FUNCTION app.api_complete_roma_project_findings(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid,
  p_status text DEFAULT 'succeeded',
  p_error text DEFAULT NULL,
  p_memory_id uuid DEFAULT NULL,
  p_audit_event_id uuid DEFAULT NULL,
  p_finding_count integer DEFAULT NULL,
  p_notification_title text DEFAULT NULL,
  p_notification_severity text DEFAULT 'low',
  p_notification_source_memory_ids uuid[] DEFAULT NULL,
  p_notification_metadata jsonb DEFAULT NULL
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
  v_status text := coalesce(nullif(btrim(p_status), ''), 'succeeded');
  v_event_id uuid;
  v_finding_count integer := CASE
    WHEN p_finding_count IS NULL THEN NULL
    ELSE greatest(p_finding_count, 0)
  END;
  v_project_id uuid;
  v_request_event_id uuid;
  v_requested_by uuid;
  v_reason text;
  v_notification jsonb := jsonb_build_object(
    'notificationIds', '[]'::jsonb,
    'notificationEventIds', '[]'::jsonb,
    'notificationAuditEventIds', '[]'::jsonb,
    'notificationInsertedCount', 0
  );
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_subject_id <> v_roma_subject THEN
    RAISE EXCEPTION 'roma subject required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job
  FROM processing_jobs
  WHERE id = p_job_id
    AND job_type = 'roma_project_findings'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'roma project findings job not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member(v_job.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('succeeded', 'failed', 'dead_letter') THEN
    RAISE EXCEPTION 'invalid status: %', v_status;
  END IF;

  SELECT
    o.id,
    (o.payload->>'projectId')::uuid,
    (o.payload->>'requestedBy')::uuid,
    nullif(o.payload->>'reason', '')
  INTO
    v_request_event_id,
    v_project_id,
    v_requested_by,
    v_reason
  FROM outbox_events o
  WHERE o.workspace_id = v_job.workspace_id
    AND o.event_type = 'roma.project_findings.requested'
    AND o.payload->>'jobId' = v_job.id::text
  ORDER BY o.created_at DESC
  LIMIT 1;

  UPDATE processing_jobs
  SET
    status = v_status,
    error = CASE WHEN v_status = 'succeeded' THEN NULL ELSE coalesce(p_error, error) END,
    updated_at = now(),
    attempt = attempt + 1
  WHERE id = p_job_id;

  UPDATE outbox_events
  SET published_at = coalesce(published_at, now())
  WHERE workspace_id = v_job.workspace_id
    AND event_type = 'roma.project_findings.requested'
    AND payload->>'jobId' = v_job.id::text
    AND published_at IS NULL;

  IF v_status = 'succeeded' AND v_project_id IS NOT NULL THEN
    PERFORM app.assert_roma_project_health_schedule_access(v_job.workspace_id, v_project_id);
    v_notification := app.create_project_notifications(
      v_job.workspace_id,
      v_project_id,
      'roma_project_findings_completed',
      v_job.id,
      'roma_project_findings',
      coalesce(
        nullif(btrim(p_notification_title), ''),
        'ROMA QA findings updated'
      ),
      coalesce(nullif(btrim(p_notification_severity), ''), 'low'),
      coalesce(v_reason, 'ROMA QA findings notification'),
      p_notification_source_memory_ids,
      coalesce(p_notification_metadata, '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
        'status', v_status,
        'requestEventId', v_request_event_id,
        'requestedBy', v_requested_by,
        'memoryId', p_memory_id,
        'auditEventId', p_audit_event_id,
        'findingCount', v_finding_count
      ))
    );
  END IF;

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
    'roma.project_findings.completed',
    jsonb_strip_nulls(jsonb_build_object(
      'jobId', v_job.id,
      'workspaceId', v_job.workspace_id,
      'status', v_status,
      'memoryId', p_memory_id,
      'auditEventId', p_audit_event_id,
      'findingCount', v_finding_count,
      'notificationIds', v_notification->'notificationIds',
      'notificationInsertedCount', v_notification->'notificationInsertedCount',
      'error', p_error
    ))
  WHERE NOT EXISTS (
    SELECT 1
    FROM outbox_events o
    WHERE o.aggregate_id = v_job.id
      AND o.event_type = 'roma.project_findings.completed'
      AND o.payload->>'status' = v_status
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'jobId', v_job.id,
    'status', v_status,
    'jobType', v_job.job_type,
    'error', p_error,
    'memoryId', p_memory_id,
    'auditEventId', p_audit_event_id,
    'findingCount', v_finding_count,
    'eventId', v_event_id,
    'notificationIds', v_notification->'notificationIds',
    'notificationEventIds', v_notification->'notificationEventIds',
    'notificationAuditEventIds', v_notification->'notificationAuditEventIds',
    'notificationInsertedCount', v_notification->'notificationInsertedCount'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_complete_roma_project_findings(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid,
  p_status text DEFAULT 'succeeded',
  p_error text DEFAULT NULL,
  p_memory_id uuid DEFAULT NULL,
  p_audit_event_id uuid DEFAULT NULL,
  p_finding_count integer DEFAULT NULL,
  p_notification_title text DEFAULT NULL,
  p_notification_severity text DEFAULT 'low',
  p_notification_source_memory_ids uuid[] DEFAULT NULL,
  p_notification_metadata jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_complete_roma_project_findings(
    p_secret,
    p_subject_id,
    p_job_id,
    p_status,
    p_error,
    p_memory_id,
    p_audit_event_id,
    p_finding_count,
    p_notification_title,
    p_notification_severity,
    p_notification_source_memory_ids,
    p_notification_metadata
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_complete_roma_project_findings(
  text, uuid, uuid, text, text, uuid, uuid, integer, text, text, uuid[], jsonb
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_complete_roma_project_findings(
  text, uuid, uuid, text, text, uuid, uuid, integer, text, text, uuid[], jsonb
) TO anon, authenticated, service_role;
