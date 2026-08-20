CREATE TABLE approval_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  checkpoint_type text NOT NULL
    CHECK (checkpoint_type IN ('roma_qa_finding_write')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  requested_by_subject uuid NOT NULL REFERENCES subjects (id) ON DELETE RESTRICT,
  execution_subject_id uuid NOT NULL REFERENCES subjects (id) ON DELETE RESTRICT,
  decided_by_subject uuid REFERENCES subjects (id) ON DELETE SET NULL,
  source_job_id uuid REFERENCES processing_jobs (id) ON DELETE SET NULL,
  source_job_type text
    CHECK (source_job_type IS NULL OR source_job_type IN ('roma_project_findings')),
  approved_memory_id uuid REFERENCES memory_records (id) ON DELETE SET NULL,
  approved_source_event_id uuid REFERENCES source_events (id) ON DELETE SET NULL,
  approved_audit_event_id uuid REFERENCES audit_log (id) ON DELETE SET NULL,
  requested_reason text NOT NULL,
  decision_reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '72 hours'),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, checkpoint_type, idempotency_key),
  CONSTRAINT approval_checkpoints_source_job_pair CHECK (
    (source_job_id IS NULL AND source_job_type IS NULL)
    OR (source_job_id IS NOT NULL AND source_job_type = 'roma_project_findings')
  ),
  CONSTRAINT approval_checkpoints_execution_subject CHECK (
    execution_subject_id = '33333333-3333-4333-8333-333333333304'::uuid
  ),
  CONSTRAINT approval_checkpoints_decision_state CHECK (
    (status = 'pending'
      AND decided_at IS NULL
      AND decided_by_subject IS NULL
      AND decision_reason IS NULL)
    OR (status IN ('approved', 'denied', 'expired')
      AND decided_at IS NOT NULL
      AND decision_reason IS NOT NULL)
  )
);

CREATE INDEX approval_checkpoints_project_status_idx
  ON approval_checkpoints (workspace_id, project_id, status, created_at DESC);

CREATE INDEX approval_checkpoints_source_job_idx
  ON approval_checkpoints (source_job_id, checkpoint_type);

ALTER TABLE approval_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_checkpoints FORCE ROW LEVEL SECURITY;

CREATE POLICY approval_checkpoints_select
  ON approval_checkpoints
  FOR SELECT
  USING (
    app.is_workspace_member(workspace_id)
    AND app.has_acl(workspace_id, 'project', 'read', project_id, 'internal')
    AND (
      requested_by_subject = app.current_subject_id()
      OR execution_subject_id = app.current_subject_id()
      OR decided_by_subject = app.current_subject_id()
      OR EXISTS (
        SELECT 1
        FROM workspace_memberships wm
        WHERE wm.workspace_id = approval_checkpoints.workspace_id
          AND wm.subject_id = app.current_subject_id()
          AND wm.role = 'owner'
      )
    )
  );

CREATE POLICY approval_checkpoints_insert
  ON approval_checkpoints
  FOR INSERT
  WITH CHECK (
    app.is_workspace_member(workspace_id)
    AND app.has_acl(workspace_id, 'project', 'read', project_id, 'internal')
    AND requested_by_subject = app.current_subject_id()
    AND execution_subject_id = '33333333-3333-4333-8333-333333333304'::uuid
    AND requested_by_subject = execution_subject_id
  );

CREATE POLICY approval_checkpoints_no_update
  ON approval_checkpoints
  FOR UPDATE
  USING (false);

CREATE POLICY approval_checkpoints_no_delete
  ON approval_checkpoints
  FOR DELETE
  USING (false);

CREATE OR REPLACE FUNCTION app.sanitize_roma_qa_finding_evidence_refs(p_refs jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, app
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'kind', NULLIF(btrim(ref.value->>'kind'), ''),
        'memoryId', NULLIF(btrim(ref.value->>'memoryId'), ''),
        'memoryType', NULLIF(btrim(COALESCE(ref.value->>'memoryType', ref.value->>'memory_type')), ''),
        'handoffId', NULLIF(btrim(ref.value->>'handoffId'), ''),
        'stateVersion', CASE
          WHEN jsonb_typeof(ref.value->'stateVersion') = 'number' THEN ref.value->'stateVersion'
          ELSE NULL
        END,
        'field', NULLIF(btrim(ref.value->>'field'), ''),
        'title', NULLIF(left(btrim(ref.value->>'title'), 160), ''),
        'titles', CASE
          WHEN jsonb_typeof(ref.value->'titles') = 'array' THEN (
            SELECT COALESCE(
              jsonb_agg(to_jsonb(left(btrim(item.value #>> '{}'), 160)) ORDER BY item.ordinality),
              '[]'::jsonb
            )
            FROM jsonb_array_elements(ref.value->'titles') WITH ORDINALITY AS item(value, ordinality)
            WHERE jsonb_typeof(item.value) = 'string'
              AND btrim(item.value #>> '{}') <> ''
          )
          ELSE NULL
        END,
        'createdAt', NULLIF(btrim(ref.value->>'createdAt'), '')
      ))
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(COALESCE(p_refs, '[]'::jsonb)) = 'array' THEN COALESCE(p_refs, '[]'::jsonb)
      ELSE '[]'::jsonb
    END
  ) AS ref(value);
$$;

CREATE OR REPLACE FUNCTION app.format_roma_qa_finding_evidence_ref(p_ref jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, app
AS $$
DECLARE
  v_kind text := COALESCE(NULLIF(btrim(p_ref->>'kind'), ''), 'unknown');
  v_memory_id text := NULLIF(btrim(p_ref->>'memoryId'), '');
  v_memory_type text := NULLIF(btrim(COALESCE(p_ref->>'memoryType', p_ref->>'memory_type')), '');
  v_handoff_id text := NULLIF(btrim(p_ref->>'handoffId'), '');
  v_field text := NULLIF(btrim(p_ref->>'field'), '');
  v_title text := NULLIF(btrim(p_ref->>'title'), '');
  v_created_at text := NULLIF(btrim(p_ref->>'createdAt'), '');
  v_state_version text := CASE
    WHEN jsonb_typeof(p_ref->'stateVersion') = 'number' THEN p_ref->>'stateVersion'
    ELSE NULL
  END;
  v_titles text[];
BEGIN
  v_titles := ARRAY(
    SELECT left(btrim(value #>> '{}'), 160)
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(COALESCE(p_ref->'titles', '[]'::jsonb)) = 'array' THEN COALESCE(p_ref->'titles', '[]'::jsonb)
        ELSE '[]'::jsonb
      END
    ) AS value
    WHERE jsonb_typeof(value) = 'string'
      AND btrim(value #>> '{}') <> ''
  );

  CASE v_kind
    WHEN 'memory' THEN
      RETURN format(
        '- memory %s%s%s',
        COALESCE(v_memory_id, 'none'),
        CASE WHEN v_memory_type IS NULL THEN '' ELSE format(' (%s)', v_memory_type) END,
        CASE WHEN v_title IS NULL THEN '' ELSE format(': %s', v_title) END
      );
    WHEN 'project_state' THEN
      RETURN format(
        '- project_state v%s field %s%s',
        COALESCE(v_state_version, 'unknown'),
        COALESCE(v_field, 'unknown'),
        CASE
          WHEN COALESCE(array_length(v_titles, 1), 0) = 0 THEN ''
          ELSE format(': %s', array_to_string(v_titles, '; '))
        END
      );
    WHEN 'handoff' THEN
      RETURN format(
        '- handoff %s%s',
        COALESCE(v_handoff_id, 'none'),
        CASE WHEN v_created_at IS NULL THEN '' ELSE format(' at %s', v_created_at) END
      );
    ELSE
      RETURN format(
        '- %s%s',
        v_kind,
        CASE WHEN v_title IS NULL THEN '' ELSE format(': %s', v_title) END
      );
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION app.api_request_roma_qa_finding_approval_checkpoint(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_title text,
  p_summary text,
  p_finding_key text,
  p_severity text,
  p_finding_status text DEFAULT 'open',
  p_reason text DEFAULT NULL,
  p_evidence_refs jsonb DEFAULT '[]'::jsonb,
  p_source_job_id uuid DEFAULT NULL,
  p_request_event_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_roma_subject constant uuid := '33333333-3333-4333-8333-333333333304';
  v_title text := NULLIF(btrim(p_title), '');
  v_summary text := NULLIF(btrim(p_summary), '');
  v_finding_key text := NULLIF(btrim(p_finding_key), '');
  v_severity text := COALESCE(NULLIF(btrim(p_severity), ''), 'medium');
  v_status text := COALESCE(NULLIF(btrim(p_finding_status), ''), 'open');
  v_reason text := COALESCE(
    NULLIF(btrim(p_reason), ''),
    'Await explicit owner approval before ROMA writes this QA finding.'
  );
  v_idem text := format(
    'roma-approval/%s/%s',
    p_project_id::text,
    COALESCE(NULLIF(btrim(p_idempotency_key), ''), COALESCE(v_finding_key, 'checkpoint'))
  );
  v_payload jsonb;
  v_checkpoint approval_checkpoints%ROWTYPE;
  v_inserted boolean := false;
  v_audit_event_id uuid;
  v_outbox_event_id uuid;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_subject_id <> v_roma_subject THEN
    RAISE EXCEPTION 'roma subject required' USING ERRCODE = '42501';
  END IF;

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required';
  END IF;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'title required';
  END IF;

  IF v_summary IS NULL THEN
    RAISE EXCEPTION 'summary required';
  END IF;

  IF v_finding_key IS NULL THEN
    RAISE EXCEPTION 'finding_key required';
  END IF;

  IF v_severity NOT IN ('low', 'medium', 'high') THEN
    RAISE EXCEPTION 'invalid severity: %', v_severity;
  END IF;

  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'invalid finding status: %', v_status;
  END IF;

  PERFORM app.assert_roma_project_health_schedule_access(p_workspace_id, p_project_id);

  v_payload := jsonb_build_object(
    'title', v_title,
    'summary', v_summary,
    'findingKey', v_finding_key,
    'severity', v_severity,
    'status', v_status,
    'evidenceRefs', app.sanitize_roma_qa_finding_evidence_refs(p_evidence_refs),
    'requestEventId', p_request_event_id
  );

  INSERT INTO approval_checkpoints (
    workspace_id,
    project_id,
    checkpoint_type,
    status,
    requested_by_subject,
    execution_subject_id,
    source_job_id,
    source_job_type,
    requested_reason,
    payload,
    idempotency_key,
    expires_at
  )
  VALUES (
    p_workspace_id,
    p_project_id,
    'roma_qa_finding_write',
    'pending',
    p_subject_id,
    v_roma_subject,
    p_source_job_id,
    CASE WHEN p_source_job_id IS NULL THEN NULL ELSE 'roma_project_findings' END,
    v_reason,
    v_payload,
    v_idem,
    COALESCE(p_expires_at, now() + interval '72 hours')
  )
  ON CONFLICT (workspace_id, checkpoint_type, idempotency_key) DO NOTHING
  RETURNING * INTO v_checkpoint;

  v_inserted := v_checkpoint.id IS NOT NULL;

  IF NOT v_inserted THEN
    SELECT *
    INTO v_checkpoint
    FROM approval_checkpoints
    WHERE workspace_id = p_workspace_id
      AND checkpoint_type = 'roma_qa_finding_write'
      AND idempotency_key = v_idem;
  ELSE
    INSERT INTO audit_log (
      workspace_id,
      actor_subject_id,
      action,
      object_type,
      object_id,
      reason,
      after_state
    )
    VALUES (
      p_workspace_id,
      p_subject_id,
      'approval.checkpoint.requested',
      'approval_checkpoint',
      v_checkpoint.id,
      v_reason,
      jsonb_build_object(
        'checkpointId', v_checkpoint.id,
        'checkpointType', v_checkpoint.checkpoint_type,
        'status', v_checkpoint.status,
        'projectId', p_project_id,
        'requestedBy', p_subject_id,
        'executionSubjectId', v_roma_subject,
        'sourceJobId', p_source_job_id,
        'payload', v_payload,
        'expiresAt', v_checkpoint.expires_at
      )
    )
    RETURNING id INTO v_audit_event_id;

    INSERT INTO outbox_events (
      workspace_id,
      aggregate_type,
      aggregate_id,
      event_type,
      payload
    )
    VALUES (
      p_workspace_id,
      'approval_checkpoint',
      v_checkpoint.id,
      'approval.checkpoint.requested',
      jsonb_build_object(
        'checkpointId', v_checkpoint.id,
        'checkpointType', v_checkpoint.checkpoint_type,
        'workspaceId', p_workspace_id,
        'projectId', p_project_id,
        'requestedBy', p_subject_id,
        'executionSubjectId', v_roma_subject,
        'sourceJobId', p_source_job_id,
        'title', v_title,
        'findingKey', v_finding_key,
        'severity', v_severity,
        'status', v_checkpoint.status,
        'reason', v_reason,
        'expiresAt', v_checkpoint.expires_at,
        'auditEventId', v_audit_event_id
      )
    )
    RETURNING id INTO v_outbox_event_id;
  END IF;

  RETURN jsonb_build_object(
    'checkpointId', v_checkpoint.id,
    'checkpointType', v_checkpoint.checkpoint_type,
    'workspaceId', v_checkpoint.workspace_id,
    'projectId', v_checkpoint.project_id,
    'status', v_checkpoint.status,
    'requestedBy', v_checkpoint.requested_by_subject,
    'executionSubjectId', v_checkpoint.execution_subject_id,
    'sourceJobId', v_checkpoint.source_job_id,
    'title', v_checkpoint.payload->>'title',
    'findingKey', v_checkpoint.payload->>'findingKey',
    'severity', v_checkpoint.payload->>'severity',
    'findingStatus', v_checkpoint.payload->>'status',
    'reason', v_checkpoint.requested_reason,
    'idempotencyKey', v_checkpoint.idempotency_key,
    'expiresAt', v_checkpoint.expires_at,
    'requestedAt', v_checkpoint.requested_at,
    'decidedAt', v_checkpoint.decided_at,
    'decidedBy', v_checkpoint.decided_by_subject,
    'decisionReason', v_checkpoint.decision_reason,
    'memoryId', v_checkpoint.approved_memory_id,
    'sourceEventId', v_checkpoint.approved_source_event_id,
    'auditEventId', v_checkpoint.approved_audit_event_id,
    'auditLogId', v_audit_event_id,
    'eventId', v_outbox_event_id,
    'inserted', v_inserted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_request_roma_qa_finding_approval_checkpoint(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_title text,
  p_summary text,
  p_finding_key text,
  p_severity text,
  p_finding_status text DEFAULT 'open',
  p_reason text DEFAULT NULL,
  p_evidence_refs jsonb DEFAULT '[]'::jsonb,
  p_source_job_id uuid DEFAULT NULL,
  p_request_event_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_request_roma_qa_finding_approval_checkpoint(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_project_id,
    p_title,
    p_summary,
    p_finding_key,
    p_severity,
    p_finding_status,
    p_reason,
    p_evidence_refs,
    p_source_job_id,
    p_request_event_id,
    p_idempotency_key,
    p_expires_at
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_request_roma_qa_finding_approval_checkpoint(
  text,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  uuid,
  uuid,
  text,
  timestamptz
)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_request_roma_qa_finding_approval_checkpoint(
  text,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  uuid,
  uuid,
  text,
  timestamptz
)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.api_decide_approval_checkpoint(
  p_secret text,
  p_subject_id uuid,
  p_checkpoint_id uuid,
  p_decision text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_checkpoint approval_checkpoints%ROWTYPE;
  v_project projects%ROWTYPE;
  v_decision text := COALESCE(NULLIF(btrim(p_decision), ''), '');
  v_reason text := NULLIF(btrim(p_reason), '');
  v_title text;
  v_summary text;
  v_finding_key text;
  v_severity text;
  v_finding_status text;
  v_evidence_refs jsonb;
  v_capture jsonb;
  v_memory_id uuid;
  v_source_event_id uuid;
  v_write_audit_id uuid;
  v_decision_audit_id uuid;
  v_outbox_event_id uuid;
  v_text text;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_checkpoint_id IS NULL THEN
    RAISE EXCEPTION 'checkpoint_id required';
  END IF;

  IF v_decision NOT IN ('approved', 'denied') THEN
    RAISE EXCEPTION 'invalid decision: %', v_decision;
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason required';
  END IF;

  SELECT *
  INTO v_checkpoint
  FROM approval_checkpoints
  WHERE id = p_checkpoint_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval checkpoint not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member(v_checkpoint.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_subject_id = v_checkpoint.execution_subject_id
     OR p_subject_id = v_checkpoint.requested_by_subject THEN
    RAISE EXCEPTION 'roma cannot self-approve approval checkpoints' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM workspace_memberships wm
    WHERE wm.workspace_id = v_checkpoint.workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'owner approval required' USING ERRCODE = '42501';
  END IF;

  IF v_checkpoint.status = 'approved' AND v_decision = 'approved' THEN
    RETURN jsonb_build_object(
      'checkpointId', v_checkpoint.id,
      'checkpointType', v_checkpoint.checkpoint_type,
      'workspaceId', v_checkpoint.workspace_id,
      'projectId', v_checkpoint.project_id,
      'status', v_checkpoint.status,
      'requestedBy', v_checkpoint.requested_by_subject,
      'executionSubjectId', v_checkpoint.execution_subject_id,
      'decidedBy', v_checkpoint.decided_by_subject,
      'decidedAt', v_checkpoint.decided_at,
      'decisionReason', v_checkpoint.decision_reason,
      'memoryId', v_checkpoint.approved_memory_id,
      'sourceEventId', v_checkpoint.approved_source_event_id,
      'auditEventId', v_checkpoint.approved_audit_event_id,
      'eventId', NULL,
      'decisionAuditEventId', NULL
    );
  END IF;

  IF v_checkpoint.status IN ('approved', 'denied', 'expired') THEN
    RETURN jsonb_build_object(
      'checkpointId', v_checkpoint.id,
      'checkpointType', v_checkpoint.checkpoint_type,
      'workspaceId', v_checkpoint.workspace_id,
      'projectId', v_checkpoint.project_id,
      'status', v_checkpoint.status,
      'requestedBy', v_checkpoint.requested_by_subject,
      'executionSubjectId', v_checkpoint.execution_subject_id,
      'decidedBy', v_checkpoint.decided_by_subject,
      'decidedAt', v_checkpoint.decided_at,
      'decisionReason', v_checkpoint.decision_reason,
      'memoryId', v_checkpoint.approved_memory_id,
      'sourceEventId', v_checkpoint.approved_source_event_id,
      'auditEventId', v_checkpoint.approved_audit_event_id,
      'eventId', NULL,
      'decisionAuditEventId', NULL
    );
  END IF;

  IF v_checkpoint.expires_at <= now() THEN
    UPDATE approval_checkpoints
    SET
      status = 'expired',
      decided_by_subject = p_subject_id,
      decision_reason = 'approval expired before decision',
      decided_at = now(),
      updated_at = now()
    WHERE id = v_checkpoint.id
    RETURNING * INTO v_checkpoint;

    INSERT INTO audit_log (
      workspace_id,
      actor_subject_id,
      action,
      object_type,
      object_id,
      reason,
      after_state
    )
    VALUES (
      v_checkpoint.workspace_id,
      p_subject_id,
      'approval.checkpoint.expired',
      'approval_checkpoint',
      v_checkpoint.id,
      'approval expired before decision',
      jsonb_build_object(
        'checkpointId', v_checkpoint.id,
        'status', v_checkpoint.status,
        'projectId', v_checkpoint.project_id,
        'requestedBy', v_checkpoint.requested_by_subject,
        'executionSubjectId', v_checkpoint.execution_subject_id
      )
    )
    RETURNING id INTO v_decision_audit_id;

    INSERT INTO outbox_events (
      workspace_id,
      aggregate_type,
      aggregate_id,
      event_type,
      payload
    )
    VALUES (
      v_checkpoint.workspace_id,
      'approval_checkpoint',
      v_checkpoint.id,
      'approval.checkpoint.expired',
      jsonb_build_object(
        'checkpointId', v_checkpoint.id,
        'checkpointType', v_checkpoint.checkpoint_type,
        'workspaceId', v_checkpoint.workspace_id,
        'projectId', v_checkpoint.project_id,
        'status', v_checkpoint.status,
        'requestedBy', v_checkpoint.requested_by_subject,
        'executionSubjectId', v_checkpoint.execution_subject_id,
        'decisionReason', v_checkpoint.decision_reason,
        'auditEventId', v_decision_audit_id
      )
    )
    RETURNING id INTO v_outbox_event_id;

    RETURN jsonb_build_object(
      'checkpointId', v_checkpoint.id,
      'checkpointType', v_checkpoint.checkpoint_type,
      'workspaceId', v_checkpoint.workspace_id,
      'projectId', v_checkpoint.project_id,
      'status', v_checkpoint.status,
      'requestedBy', v_checkpoint.requested_by_subject,
      'executionSubjectId', v_checkpoint.execution_subject_id,
      'decidedBy', v_checkpoint.decided_by_subject,
      'decidedAt', v_checkpoint.decided_at,
      'decisionReason', v_checkpoint.decision_reason,
      'memoryId', v_checkpoint.approved_memory_id,
      'sourceEventId', v_checkpoint.approved_source_event_id,
      'auditEventId', v_checkpoint.approved_audit_event_id,
      'eventId', v_outbox_event_id,
      'decisionAuditEventId', v_decision_audit_id
    );
  END IF;

  IF v_decision = 'denied' THEN
    UPDATE approval_checkpoints
    SET
      status = 'denied',
      decided_by_subject = p_subject_id,
      decision_reason = v_reason,
      decided_at = now(),
      updated_at = now()
    WHERE id = v_checkpoint.id
    RETURNING * INTO v_checkpoint;

    INSERT INTO audit_log (
      workspace_id,
      actor_subject_id,
      action,
      object_type,
      object_id,
      reason,
      after_state
    )
    VALUES (
      v_checkpoint.workspace_id,
      p_subject_id,
      'approval.checkpoint.denied',
      'approval_checkpoint',
      v_checkpoint.id,
      v_reason,
      jsonb_build_object(
        'checkpointId', v_checkpoint.id,
        'status', v_checkpoint.status,
        'projectId', v_checkpoint.project_id,
        'requestedBy', v_checkpoint.requested_by_subject,
        'executionSubjectId', v_checkpoint.execution_subject_id
      )
    )
    RETURNING id INTO v_decision_audit_id;

    INSERT INTO outbox_events (
      workspace_id,
      aggregate_type,
      aggregate_id,
      event_type,
      payload
    )
    VALUES (
      v_checkpoint.workspace_id,
      'approval_checkpoint',
      v_checkpoint.id,
      'approval.checkpoint.denied',
      jsonb_build_object(
        'checkpointId', v_checkpoint.id,
        'checkpointType', v_checkpoint.checkpoint_type,
        'workspaceId', v_checkpoint.workspace_id,
        'projectId', v_checkpoint.project_id,
        'status', v_checkpoint.status,
        'requestedBy', v_checkpoint.requested_by_subject,
        'executionSubjectId', v_checkpoint.execution_subject_id,
        'decisionReason', v_checkpoint.decision_reason,
        'auditEventId', v_decision_audit_id
      )
    )
    RETURNING id INTO v_outbox_event_id;

    RETURN jsonb_build_object(
      'checkpointId', v_checkpoint.id,
      'checkpointType', v_checkpoint.checkpoint_type,
      'workspaceId', v_checkpoint.workspace_id,
      'projectId', v_checkpoint.project_id,
      'status', v_checkpoint.status,
      'requestedBy', v_checkpoint.requested_by_subject,
      'executionSubjectId', v_checkpoint.execution_subject_id,
      'decidedBy', v_checkpoint.decided_by_subject,
      'decidedAt', v_checkpoint.decided_at,
      'decisionReason', v_checkpoint.decision_reason,
      'memoryId', NULL,
      'sourceEventId', NULL,
      'auditEventId', NULL,
      'eventId', v_outbox_event_id,
      'decisionAuditEventId', v_decision_audit_id
    );
  END IF;

  SELECT *
  INTO v_project
  FROM projects
  WHERE id = v_checkpoint.project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

  v_title := v_checkpoint.payload->>'title';
  v_summary := v_checkpoint.payload->>'summary';
  v_finding_key := v_checkpoint.payload->>'findingKey';
  v_severity := v_checkpoint.payload->>'severity';
  v_finding_status := v_checkpoint.payload->>'status';
  v_evidence_refs := COALESCE(v_checkpoint.payload->'evidenceRefs', '[]'::jsonb);

  v_text := concat_ws(
    E'\n',
    'ROMA QA finding',
    format('Project: %s (%s)', v_project.name, v_project.slug),
    format('Project status: %s', v_project.status),
    format('Project ID: %s', v_project.id),
    format('Finding key: %s', v_finding_key),
    format('Severity: %s', v_severity),
    format('Status: %s', v_finding_status),
    format('Execution subject: ROMA (%s)', v_checkpoint.execution_subject_id),
    format('Requested by: %s', v_checkpoint.requested_by_subject),
    format('Approved by: %s', p_subject_id),
    format('Reason: %s', v_checkpoint.requested_reason),
    'Bounded scope: one explicit project, one finding memory, source IDs/titles only.',
    '',
    format('Summary: %s', v_summary),
    '',
    'Evidence refs',
    COALESCE((
      SELECT string_agg(app.format_roma_qa_finding_evidence_ref(ref.value), E'\n' ORDER BY ref.ordinality)
      FROM jsonb_array_elements(v_evidence_refs) WITH ORDINALITY AS ref(value, ordinality)
    ), '- none'),
    '',
    'Audit',
    format('- Approval checkpoint ID: %s', v_checkpoint.id),
    format('- Source job ID: %s', COALESCE(v_checkpoint.source_job_id::text, 'none')),
    format('- Request event ID: %s', COALESCE(v_checkpoint.payload->>'requestEventId', 'none')),
    format('- Idempotency key: %s', v_checkpoint.idempotency_key),
    '- Note: this finding stores titles and structured evidence refs only; raw memory bodies are not quoted.',
    '- ACL note: personal, confidential, and restricted memories remain excluded from ROMA access.'
  );

  v_capture := app.api_capture_connector_record(
    p_secret,
    v_checkpoint.execution_subject_id,
    v_checkpoint.workspace_id,
    v_checkpoint.project_id,
    'roma',
    'service:roma',
    format('qa-finding-approval/%s/%s/%s', v_checkpoint.project_id::text, COALESCE(v_finding_key, 'finding'), v_checkpoint.id::text),
    '1',
    'roma.qa_finding.created',
    v_title,
    v_text,
    v_checkpoint.idempotency_key,
    'internal',
    'indexed',
    now(),
    format('roma-qa-finding-approval-%s-%s.md', v_checkpoint.project_id::text, COALESCE(v_finding_key, 'finding')),
    'text/markdown',
    format('memory-os://roma/qa-findings/%s/%s', v_checkpoint.project_id::text, COALESCE(v_finding_key, 'finding')),
    jsonb_build_object(
      'automation', jsonb_strip_nulls(jsonb_build_object(
        'checkpointType', v_checkpoint.checkpoint_type,
        'checkpointId', v_checkpoint.id,
        'jobType', v_checkpoint.source_job_type,
        'jobId', v_checkpoint.source_job_id,
        'requestEventId', v_checkpoint.payload->>'requestEventId',
        'requestedBy', v_checkpoint.requested_by_subject,
        'executionSubjectId', v_checkpoint.execution_subject_id,
        'approvedBy', p_subject_id,
        'idempotencyKey', v_checkpoint.idempotency_key
      )),
      'scope', jsonb_build_object(
        'workspaceId', v_checkpoint.workspace_id,
        'projectId', v_checkpoint.project_id
      ),
      'reason', v_checkpoint.requested_reason
    ),
    jsonb_build_object(
      'summary_type', 'qa_finding',
      'project_slug', v_project.slug,
      'project_name', v_project.name,
      'project_status', v_project.status,
      'finding_key', v_finding_key,
      'finding_severity', v_severity,
      'finding_status', v_finding_status,
      'evidence_refs', v_evidence_refs,
      'approval_checkpoint_id', v_checkpoint.id,
      'approval_status', 'approved'
    ),
    true
  );

  v_memory_id := NULLIF(v_capture #>> '{process,memoryId}', '')::uuid;
  v_source_event_id := NULLIF(v_capture->>'eventId', '')::uuid;

  IF v_memory_id IS NULL THEN
    RAISE EXCEPTION 'approved checkpoint write did not produce a memory';
  END IF;

  v_write_audit_id := (
    app.api_append_audit_event(
      p_secret,
      v_checkpoint.execution_subject_id,
      v_checkpoint.workspace_id,
      'roma.qa_finding.written',
      'memory',
      v_memory_id,
      v_checkpoint.requested_reason,
      NULL,
      jsonb_build_object(
        'checkpointId', v_checkpoint.id,
        'projectId', v_checkpoint.project_id,
        'jobId', v_checkpoint.source_job_id,
        'requestEventId', v_checkpoint.payload->>'requestEventId',
        'requestedBy', v_checkpoint.requested_by_subject,
        'approvedBy', p_subject_id,
        'executionSubjectId', v_checkpoint.execution_subject_id,
        'memoryId', v_memory_id,
        'sourceEventId', v_source_event_id,
        'findingKey', v_finding_key,
        'findingTitle', v_title,
        'severity', v_severity,
        'status', v_finding_status,
        'evidenceRefs', v_evidence_refs
      )
    ) ->> 'id'
  )::uuid;

  UPDATE approval_checkpoints
  SET
    status = 'approved',
    decided_by_subject = p_subject_id,
    decision_reason = v_reason,
    decided_at = now(),
    updated_at = now(),
    approved_memory_id = v_memory_id,
    approved_source_event_id = v_source_event_id,
    approved_audit_event_id = v_write_audit_id
  WHERE id = v_checkpoint.id
  RETURNING * INTO v_checkpoint;

  INSERT INTO audit_log (
    workspace_id,
    actor_subject_id,
    action,
    object_type,
    object_id,
    reason,
    after_state
  )
  VALUES (
    v_checkpoint.workspace_id,
    p_subject_id,
    'approval.checkpoint.approved',
    'approval_checkpoint',
    v_checkpoint.id,
    v_reason,
    jsonb_build_object(
      'checkpointId', v_checkpoint.id,
      'status', v_checkpoint.status,
      'projectId', v_checkpoint.project_id,
      'requestedBy', v_checkpoint.requested_by_subject,
      'executionSubjectId', v_checkpoint.execution_subject_id,
      'memoryId', v_memory_id,
      'sourceEventId', v_source_event_id,
      'auditEventId', v_write_audit_id
    )
  )
  RETURNING id INTO v_decision_audit_id;

  INSERT INTO outbox_events (
    workspace_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload
  )
  VALUES (
    v_checkpoint.workspace_id,
    'approval_checkpoint',
    v_checkpoint.id,
    'approval.checkpoint.approved',
    jsonb_build_object(
      'checkpointId', v_checkpoint.id,
      'checkpointType', v_checkpoint.checkpoint_type,
      'workspaceId', v_checkpoint.workspace_id,
      'projectId', v_checkpoint.project_id,
      'status', v_checkpoint.status,
      'requestedBy', v_checkpoint.requested_by_subject,
      'executionSubjectId', v_checkpoint.execution_subject_id,
      'decidedBy', v_checkpoint.decided_by_subject,
      'decisionReason', v_checkpoint.decision_reason,
      'memoryId', v_memory_id,
      'sourceEventId', v_source_event_id,
      'auditEventId', v_write_audit_id,
      'decisionAuditEventId', v_decision_audit_id
    )
  )
  RETURNING id INTO v_outbox_event_id;

  RETURN jsonb_build_object(
    'checkpointId', v_checkpoint.id,
    'checkpointType', v_checkpoint.checkpoint_type,
    'workspaceId', v_checkpoint.workspace_id,
    'projectId', v_checkpoint.project_id,
    'status', v_checkpoint.status,
    'requestedBy', v_checkpoint.requested_by_subject,
    'executionSubjectId', v_checkpoint.execution_subject_id,
    'decidedBy', v_checkpoint.decided_by_subject,
    'decidedAt', v_checkpoint.decided_at,
    'decisionReason', v_checkpoint.decision_reason,
    'memoryId', v_memory_id,
    'sourceEventId', v_source_event_id,
    'auditEventId', v_write_audit_id,
    'eventId', v_outbox_event_id,
    'decisionAuditEventId', v_decision_audit_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_decide_approval_checkpoint(
  p_secret text,
  p_subject_id uuid,
  p_checkpoint_id uuid,
  p_decision text,
  p_reason text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_decide_approval_checkpoint(
    p_secret,
    p_subject_id,
    p_checkpoint_id,
    p_decision,
    p_reason
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_decide_approval_checkpoint(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_decide_approval_checkpoint(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
