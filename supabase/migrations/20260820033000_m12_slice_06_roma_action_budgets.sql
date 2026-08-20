CREATE TABLE roma_action_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  max_actions integer NOT NULL CHECK (max_actions BETWEEN 1 AND 100000),
  window_minutes integer NOT NULL CHECK (window_minutes BETWEEN 1 AND 10080),
  disabled_at timestamptz,
  disabled_reason text,
  created_by_subject uuid REFERENCES subjects (id) ON DELETE SET NULL,
  updated_by_subject uuid REFERENCES subjects (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id)
);

CREATE INDEX roma_action_budgets_workspace_project_idx
  ON roma_action_budgets (workspace_id, project_id);

ALTER TABLE roma_action_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE roma_action_budgets FORCE ROW LEVEL SECURITY;

CREATE POLICY roma_action_budgets_select
  ON roma_action_budgets
  FOR SELECT
  USING (
    app.is_workspace_member(workspace_id)
    AND app.has_acl(workspace_id, 'project', 'read', project_id, 'internal')
  );

CREATE POLICY roma_action_budgets_no_insert
  ON roma_action_budgets
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY roma_action_budgets_no_update
  ON roma_action_budgets
  FOR UPDATE
  USING (false);

CREATE POLICY roma_action_budgets_no_delete
  ON roma_action_budgets
  FOR DELETE
  USING (false);

CREATE TABLE roma_action_budget_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES roma_action_budgets (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  action_type text NOT NULL
    CHECK (action_type IN (
      'roma_project_health_write',
      'roma_project_finding_write',
      'roma_approval_checkpoint_write'
    )),
  idempotency_key text NOT NULL,
  source_job_id uuid REFERENCES processing_jobs (id) ON DELETE SET NULL,
  source_checkpoint_id uuid REFERENCES approval_checkpoints (id) ON DELETE SET NULL,
  requested_by_subject uuid REFERENCES subjects (id) ON DELETE SET NULL,
  execution_subject_id uuid NOT NULL REFERENCES subjects (id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_id, idempotency_key),
  CONSTRAINT roma_action_budget_events_execution_subject CHECK (
    execution_subject_id = '33333333-3333-4333-8333-333333333304'::uuid
  ),
  CONSTRAINT roma_action_budget_events_source_checkpoint_type CHECK (
    source_checkpoint_id IS NULL
    OR action_type = 'roma_approval_checkpoint_write'
  )
);

CREATE INDEX roma_action_budget_events_budget_recorded_idx
  ON roma_action_budget_events (budget_id, recorded_at DESC);

CREATE INDEX roma_action_budget_events_workspace_project_idx
  ON roma_action_budget_events (workspace_id, project_id, recorded_at DESC);

ALTER TABLE roma_action_budget_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE roma_action_budget_events FORCE ROW LEVEL SECURITY;

CREATE POLICY roma_action_budget_events_select
  ON roma_action_budget_events
  FOR SELECT
  USING (
    app.is_workspace_member(workspace_id)
    AND app.has_acl(workspace_id, 'project', 'read', project_id, 'internal')
  );

CREATE POLICY roma_action_budget_events_no_insert
  ON roma_action_budget_events
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY roma_action_budget_events_no_update
  ON roma_action_budget_events
  FOR UPDATE
  USING (false);

CREATE POLICY roma_action_budget_events_no_delete
  ON roma_action_budget_events
  FOR DELETE
  USING (false);

CREATE OR REPLACE FUNCTION app.assert_roma_action_budget_admin_access(
  p_workspace_id uuid,
  p_project_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_roma_subject constant uuid := '33333333-3333-4333-8333-333333333304';
BEGIN
  IF app.current_subject_id() = v_roma_subject THEN
    RAISE EXCEPTION 'roma cannot raise its own action budget' USING ERRCODE = '42501';
  END IF;

  PERFORM app.assert_roma_project_health_schedule_access(p_workspace_id, p_project_id);
END;
$$;

CREATE OR REPLACE FUNCTION app.consume_roma_action_budget(
  p_workspace_id uuid,
  p_project_id uuid,
  p_action_type text,
  p_idempotency_key text,
  p_source_job_id uuid DEFAULT NULL,
  p_source_checkpoint_id uuid DEFAULT NULL,
  p_requested_by_subject uuid DEFAULT NULL,
  p_execution_subject_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_roma_subject constant uuid := '33333333-3333-4333-8333-333333333304';
  v_budget roma_action_budgets%ROWTYPE;
  v_existing_event roma_action_budget_events%ROWTYPE;
  v_action_type text := COALESCE(NULLIF(btrim(p_action_type), ''), '');
  v_idempotency_key text := COALESCE(NULLIF(btrim(p_idempotency_key), ''), '');
  v_execution_subject_id uuid := COALESCE(p_execution_subject_id, v_roma_subject);
  v_current_count integer := 0;
  v_remaining integer;
  v_cutoff timestamptz;
  v_error text;
  v_audit_event_id uuid;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required';
  END IF;

  IF v_action_type NOT IN (
    'roma_project_health_write',
    'roma_project_finding_write',
    'roma_approval_checkpoint_write'
  ) THEN
    RAISE EXCEPTION 'invalid action type: %', v_action_type;
  END IF;

  IF v_idempotency_key = '' THEN
    RAISE EXCEPTION 'idempotency key required';
  END IF;

  IF v_execution_subject_id <> v_roma_subject THEN
    RAISE EXCEPTION 'roma execution subject required' USING ERRCODE = '42501';
  END IF;

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_budget
  FROM roma_action_budgets
  WHERE workspace_id = p_workspace_id
    AND project_id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_error := format(
      'roma action budget not configured for project %s',
      p_project_id::text
    );

    INSERT INTO audit_log (
      workspace_id,
      actor_subject_id,
      action,
      object_type,
      object_id,
      reason,
      after_state
    ) VALUES (
      p_workspace_id,
      app.current_subject_id(),
      'roma.action_budget.rejected',
      'project',
      p_project_id,
      v_error,
      jsonb_build_object(
        'projectId', p_project_id,
        'actionType', v_action_type,
        'idempotencyKey', v_idempotency_key,
        'sourceJobId', p_source_job_id,
        'sourceCheckpointId', p_source_checkpoint_id,
        'requestedBy', p_requested_by_subject,
        'executionSubjectId', v_execution_subject_id,
        'budgetConfigured', false
      )
    )
    RETURNING id INTO v_audit_event_id;

    RETURN jsonb_build_object(
      'allowed', false,
      'projectId', p_project_id,
      'actionType', v_action_type,
      'error', v_error,
      'auditEventId', v_audit_event_id,
      'budgetConfigured', false,
      'enabled', false
    );
  END IF;

  IF v_budget.disabled_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'budgetId', v_budget.id,
      'projectId', p_project_id,
      'actionType', v_action_type,
      'actionEventId', NULL,
      'budgetConfigured', true,
      'enabled', false,
      'disabledAt', v_budget.disabled_at,
      'disabledReason', v_budget.disabled_reason,
      'maxActions', v_budget.max_actions,
      'windowMinutes', v_budget.window_minutes,
      'remaining', NULL
    );
  END IF;

  SELECT *
  INTO v_existing_event
  FROM roma_action_budget_events
  WHERE budget_id = v_budget.id
    AND idempotency_key = v_idempotency_key;

  IF FOUND THEN
    v_cutoff := now() - make_interval(mins => v_budget.window_minutes);
    SELECT count(*)
    INTO v_current_count
    FROM roma_action_budget_events
    WHERE budget_id = v_budget.id
      AND recorded_at >= v_cutoff;
    v_remaining := greatest(v_budget.max_actions - v_current_count, 0);

    RETURN jsonb_build_object(
      'allowed', true,
      'budgetId', v_budget.id,
      'projectId', p_project_id,
      'actionType', v_action_type,
      'actionEventId', v_existing_event.id,
      'budgetConfigured', true,
      'enabled', true,
      'maxActions', v_budget.max_actions,
      'windowMinutes', v_budget.window_minutes,
      'actionCount', v_current_count,
      'remaining', v_remaining
    );
  END IF;

  v_cutoff := now() - make_interval(mins => v_budget.window_minutes);

  SELECT count(*)
  INTO v_current_count
  FROM roma_action_budget_events
  WHERE budget_id = v_budget.id
    AND recorded_at >= v_cutoff;

  IF v_current_count >= v_budget.max_actions THEN
    v_error := format(
      'roma action budget exceeded for project %s (%s writes per %s minutes)',
      p_project_id::text,
      v_budget.max_actions,
      v_budget.window_minutes
    );

    INSERT INTO audit_log (
      workspace_id,
      actor_subject_id,
      action,
      object_type,
      object_id,
      reason,
      after_state
    ) VALUES (
      p_workspace_id,
      app.current_subject_id(),
      'roma.action_budget.rejected',
      'roma_action_budget',
      v_budget.id,
      v_error,
      jsonb_build_object(
        'budgetId', v_budget.id,
        'projectId', p_project_id,
        'actionType', v_action_type,
        'idempotencyKey', v_idempotency_key,
        'sourceJobId', p_source_job_id,
        'sourceCheckpointId', p_source_checkpoint_id,
        'requestedBy', p_requested_by_subject,
        'executionSubjectId', v_execution_subject_id,
        'budgetConfigured', true,
        'enabled', true,
        'maxActions', v_budget.max_actions,
        'windowMinutes', v_budget.window_minutes,
        'actionCount', v_current_count
      )
    )
    RETURNING id INTO v_audit_event_id;

    RETURN jsonb_build_object(
      'allowed', false,
      'budgetId', v_budget.id,
      'projectId', p_project_id,
      'actionType', v_action_type,
      'error', v_error,
      'auditEventId', v_audit_event_id,
      'budgetConfigured', true,
      'enabled', true,
      'maxActions', v_budget.max_actions,
      'windowMinutes', v_budget.window_minutes,
      'actionCount', v_current_count,
      'remaining', 0
    );
  END IF;

  INSERT INTO roma_action_budget_events (
    budget_id,
    workspace_id,
    project_id,
    action_type,
    idempotency_key,
    source_job_id,
    source_checkpoint_id,
    requested_by_subject,
    execution_subject_id
  ) VALUES (
    v_budget.id,
    p_workspace_id,
    p_project_id,
    v_action_type,
    v_idempotency_key,
    p_source_job_id,
    p_source_checkpoint_id,
    p_requested_by_subject,
    v_execution_subject_id
  )
  RETURNING * INTO v_existing_event;

  v_remaining := greatest(v_budget.max_actions - (v_current_count + 1), 0);

  RETURN jsonb_build_object(
    'allowed', true,
    'budgetId', v_budget.id,
    'projectId', p_project_id,
    'actionType', v_action_type,
    'actionEventId', v_existing_event.id,
    'budgetConfigured', true,
    'enabled', true,
    'maxActions', v_budget.max_actions,
    'windowMinutes', v_budget.window_minutes,
    'actionCount', v_current_count + 1,
    'remaining', v_remaining
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.api_upsert_roma_action_budget(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_max_actions integer,
  p_window_minutes integer,
  p_enabled boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_existing roma_action_budgets%ROWTYPE;
  v_row roma_action_budgets%ROWTYPE;
  v_now timestamptz := now();
  v_before jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_max_actions IS NULL OR p_max_actions < 1 OR p_max_actions > 100000 THEN
    RAISE EXCEPTION 'max_actions must be between 1 and 100000';
  END IF;

  IF p_window_minutes IS NULL OR p_window_minutes < 1 OR p_window_minutes > 10080 THEN
    RAISE EXCEPTION 'window_minutes must be between 1 and 10080';
  END IF;

  PERFORM app.assert_roma_action_budget_admin_access(p_workspace_id, p_project_id);

  SELECT *
  INTO v_existing
  FROM roma_action_budgets
  WHERE workspace_id = p_workspace_id
    AND project_id = p_project_id
  FOR UPDATE;

  IF FOUND THEN
    v_before := jsonb_build_object(
      'budgetId', v_existing.id,
      'projectId', v_existing.project_id,
      'maxActions', v_existing.max_actions,
      'windowMinutes', v_existing.window_minutes,
      'enabled', v_existing.disabled_at IS NULL,
      'disabledAt', v_existing.disabled_at,
      'disabledReason', v_existing.disabled_reason
    );

    UPDATE roma_action_budgets
    SET
      max_actions = p_max_actions,
      window_minutes = p_window_minutes,
      disabled_at = CASE
        WHEN p_enabled IS TRUE THEN NULL
        WHEN p_enabled IS FALSE THEN COALESCE(v_existing.disabled_at, v_now)
        ELSE v_existing.disabled_at
      END,
      disabled_reason = CASE
        WHEN p_enabled IS TRUE THEN NULL
        WHEN p_enabled IS FALSE THEN 'disabled by operator'
        ELSE v_existing.disabled_reason
      END,
      updated_at = v_now,
      updated_by_subject = p_subject_id
    WHERE id = v_existing.id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO roma_action_budgets (
      workspace_id,
      project_id,
      max_actions,
      window_minutes,
      disabled_at,
      disabled_reason,
      created_by_subject,
      updated_by_subject
    ) VALUES (
      p_workspace_id,
      p_project_id,
      p_max_actions,
      p_window_minutes,
      CASE WHEN COALESCE(p_enabled, true) THEN NULL ELSE v_now END,
      CASE WHEN COALESCE(p_enabled, true) THEN NULL ELSE 'disabled by operator' END,
      p_subject_id,
      p_subject_id
    )
    RETURNING * INTO v_row;
  END IF;

  PERFORM app.api_append_audit_event(
    p_secret,
    p_subject_id,
    p_workspace_id,
    'roma.action_budget.upserted',
    'roma_action_budget',
    v_row.id,
    NULL,
    v_before,
    jsonb_build_object(
      'budgetId', v_row.id,
      'projectId', v_row.project_id,
      'maxActions', v_row.max_actions,
      'windowMinutes', v_row.window_minutes,
      'enabled', v_row.disabled_at IS NULL,
      'disabledAt', v_row.disabled_at,
      'disabledReason', v_row.disabled_reason
    )
  );

  RETURN jsonb_build_object(
    'budgetId', v_row.id,
    'workspaceId', v_row.workspace_id,
    'projectId', v_row.project_id,
    'maxActions', v_row.max_actions,
    'windowMinutes', v_row.window_minutes,
    'enabled', v_row.disabled_at IS NULL,
    'disabledAt', v_row.disabled_at,
    'disabledReason', v_row.disabled_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_upsert_roma_action_budget(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_max_actions integer,
  p_window_minutes integer,
  p_enabled boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_upsert_roma_action_budget(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_project_id,
    p_max_actions,
    p_window_minutes,
    p_enabled
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_upsert_roma_action_budget(text, uuid, uuid, uuid, integer, integer, boolean)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_upsert_roma_action_budget(text, uuid, uuid, uuid, integer, integer, boolean)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.api_capture_connector_record(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_provider text,
  p_account_id text DEFAULT NULL,
  p_external_id text DEFAULT NULL,
  p_external_version text DEFAULT NULL,
  p_event_type text DEFAULT 'connector.object.captured',
  p_title text DEFAULT NULL,
  p_text text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_sensitivity text DEFAULT 'internal',
  p_storage_mode text DEFAULT 'reference',
  p_observed_at timestamptz DEFAULT now(),
  p_filename text DEFAULT NULL,
  p_mime_type text DEFAULT 'text/plain',
  p_canonical_reference text DEFAULT NULL,
  p_provenance jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_process_now boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_event_id uuid;
  v_artifact_id uuid;
  v_job_id uuid;
  v_checksum text;
  v_process jsonb;
  v_mime text := coalesce(nullif(btrim(p_mime_type), ''), 'text/plain');
  v_provider text := coalesce(nullif(btrim(p_provider), ''), 'connector');
  v_event_type text := coalesce(nullif(btrim(p_event_type), ''), 'connector.object.captured');
  v_idempotency_key text := coalesce(nullif(btrim(p_idempotency_key), ''), '');
  v_title text := coalesce(nullif(btrim(p_title), ''), 'Connector item');
  v_storage_mode text := CASE
    WHEN p_storage_mode IN ('reference', 'indexed', 'archived') THEN p_storage_mode
    ELSE 'reference'
  END;
  v_external_id text := coalesce(nullif(btrim(p_external_id), ''), v_idempotency_key);
  v_budget_result jsonb;
  v_budget_action_type text;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF v_idempotency_key = '' THEN
    RAISE EXCEPTION 'idempotency key required';
  END IF;

  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RAISE EXCEPTION 'text required';
  END IF;

  IF NOT app.has_acl(p_workspace_id, 'memory', 'write', p_project_id, p_sensitivity) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_provider = 'roma' THEN
    v_budget_action_type := CASE
      WHEN COALESCE(p_provenance #>> '{automation,checkpointId}', '') <> '' THEN 'roma_approval_checkpoint_write'
      WHEN COALESCE(p_provenance #>> '{automation,jobType}', '') = 'roma_project_health' THEN 'roma_project_health_write'
      WHEN COALESCE(p_provenance #>> '{automation,jobType}', '') = 'roma_project_findings' THEN 'roma_project_finding_write'
      ELSE NULL
    END;

    IF v_budget_action_type IS NOT NULL THEN
      v_budget_result := app.consume_roma_action_budget(
        p_workspace_id,
        p_project_id,
        v_budget_action_type,
        v_idempotency_key,
        NULLIF(p_provenance #>> '{automation,jobId}', '')::uuid,
        NULLIF(p_provenance #>> '{automation,checkpointId}', '')::uuid,
        NULLIF(p_provenance #>> '{automation,requestedBy}', '')::uuid,
        NULLIF(p_provenance #>> '{automation,executionSubjectId}', '')::uuid
      );

      IF COALESCE((v_budget_result->>'allowed')::boolean, false) IS NOT TRUE THEN
        RETURN jsonb_strip_nulls(jsonb_build_object(
          'error', v_budget_result->>'error',
          'budgetActionType', v_budget_action_type,
          'budgetAuditEventId', v_budget_result->>'auditEventId',
          'budgetId', v_budget_result->>'budgetId'
        ));
      END IF;
    END IF;
  END IF;

  v_checksum := encode(digest(convert_to(p_text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO source_events (
    workspace_id,
    project_id,
    provider,
    event_type,
    idempotency_key,
    observed_at,
    sensitivity,
    storage_mode,
    payload,
    content_checksum,
    created_by_subject
  ) VALUES (
    p_workspace_id,
    p_project_id,
    v_provider,
    v_event_type,
    v_idempotency_key,
    coalesce(p_observed_at, now()),
    p_sensitivity,
    v_storage_mode,
    jsonb_strip_nulls(jsonb_build_object(
      'schema_version', '1.0',
      'title', v_title,
      'filename', p_filename,
      'mime_type', v_mime,
      'source', jsonb_strip_nulls(jsonb_build_object(
        'provider', v_provider,
        'account_id', p_account_id,
        'external_id', v_external_id,
        'external_version', p_external_version
      )),
      'event_type', v_event_type,
      'observed_at', coalesce(p_observed_at, now()),
      'idempotency_key', v_idempotency_key,
      'content', jsonb_strip_nulls(jsonb_build_object(
        'mime_type', v_mime,
        'text', p_text,
        'checksum', v_checksum,
        'reference', p_canonical_reference
      )),
      'scope', jsonb_build_object(
        'project_id', p_project_id,
        'sensitivity', p_sensitivity,
        'storage_mode', v_storage_mode
      ),
      'provenance', coalesce(p_provenance, '{}'::jsonb),
      'metadata', coalesce(p_metadata, '{}'::jsonb),
      'quarantine', true
    )),
    v_checksum,
    p_subject_id
  )
  ON CONFLICT (workspace_id, provider, idempotency_key) DO NOTHING;

  SELECT id INTO v_event_id
  FROM source_events
  WHERE workspace_id = p_workspace_id
    AND provider = v_provider
    AND idempotency_key = v_idempotency_key;

  SELECT id INTO v_artifact_id
  FROM artifacts
  WHERE source_event_id = v_event_id
  LIMIT 1;

  IF v_artifact_id IS NULL THEN
    INSERT INTO artifacts (
      workspace_id,
      project_id,
      source_event_id,
      mime_type,
      storage_mode,
      storage_key,
      checksum_sha256,
      byte_size,
      version_label,
      metadata
    ) VALUES (
      p_workspace_id,
      p_project_id,
      v_event_id,
      v_mime,
      v_storage_mode,
      format('connector/%s/%s/%s', v_provider, p_workspace_id, v_event_id),
      v_checksum,
      octet_length(p_text),
      coalesce(nullif(btrim(p_external_version), ''), '1'),
      jsonb_strip_nulls(jsonb_build_object(
        'quarantine', true,
        'title', v_title,
        'text', p_text,
        'filename', p_filename,
        'source_mime_type', v_mime,
        'provider', v_provider,
        'account_id', p_account_id,
        'external_id', v_external_id,
        'external_version', p_external_version,
        'canonical_reference', p_canonical_reference,
        'provenance', coalesce(p_provenance, '{}'::jsonb),
        'metadata', coalesce(p_metadata, '{}'::jsonb)
      ))
    )
    RETURNING id INTO v_artifact_id;
  END IF;

  INSERT INTO processing_jobs (
    workspace_id,
    job_type,
    status,
    source_event_id,
    idempotency_key
  ) VALUES (
    p_workspace_id,
    'ingest',
    'queued',
    v_event_id,
    v_idempotency_key
  )
  ON CONFLICT (workspace_id, job_type, idempotency_key) DO NOTHING;

  SELECT id INTO v_job_id
  FROM processing_jobs
  WHERE workspace_id = p_workspace_id
    AND job_type = 'ingest'
    AND idempotency_key = v_idempotency_key;

  INSERT INTO outbox_events (
    workspace_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload
  )
  SELECT
    p_workspace_id,
    'source_event',
    v_event_id,
    'connector.capture.queued',
    jsonb_build_object(
      'job_id', v_job_id,
      'artifact_id', v_artifact_id,
      'checksum', v_checksum,
      'provider', v_provider,
      'event_type', v_event_type,
      'storage_mode', v_storage_mode
    )
  WHERE NOT EXISTS (
    SELECT 1
    FROM outbox_events o
    WHERE o.aggregate_id = v_event_id
      AND o.event_type = 'connector.capture.queued'
  );

  IF p_process_now THEN
    v_process := app.api_process_ingest_job(p_secret, p_subject_id, v_job_id);
  END IF;

  RETURN jsonb_build_object(
    'eventId', v_event_id,
    'artifactId', v_artifact_id,
    'jobId', v_job_id,
    'checksum', v_checksum,
    'provider', v_provider,
    'process', v_process
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_capture_connector_record(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_provider text,
  p_account_id text DEFAULT NULL,
  p_external_id text DEFAULT NULL,
  p_external_version text DEFAULT NULL,
  p_event_type text DEFAULT 'connector.object.captured',
  p_title text DEFAULT NULL,
  p_text text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_sensitivity text DEFAULT 'internal',
  p_storage_mode text DEFAULT 'reference',
  p_observed_at timestamptz DEFAULT now(),
  p_filename text DEFAULT NULL,
  p_mime_type text DEFAULT 'text/plain',
  p_canonical_reference text DEFAULT NULL,
  p_provenance jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_process_now boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_capture_connector_record(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_project_id,
    p_provider,
    p_account_id,
    p_external_id,
    p_external_version,
    p_event_type,
    p_title,
    p_text,
    p_idempotency_key,
    p_sensitivity,
    p_storage_mode,
    p_observed_at,
    p_filename,
    p_mime_type,
    p_canonical_reference,
    p_provenance,
    p_metadata,
    p_process_now
  );
$$;

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

  IF COALESCE(v_capture->>'error', '') <> '' THEN
    RETURN jsonb_build_object(
      'checkpointId', v_checkpoint.id,
      'checkpointType', v_checkpoint.checkpoint_type,
      'workspaceId', v_checkpoint.workspace_id,
      'projectId', v_checkpoint.project_id,
      'status', v_checkpoint.status,
      'requestedBy', v_checkpoint.requested_by_subject,
      'executionSubjectId', v_checkpoint.execution_subject_id,
      'decidedBy', NULL,
      'decidedAt', NULL,
      'decisionReason', NULL,
      'memoryId', NULL,
      'sourceEventId', NULL,
      'auditEventId', NULL,
      'eventId', NULL,
      'decisionAuditEventId', NULL,
      'error', v_capture->>'error',
      'budgetAuditEventId', v_capture->>'budgetAuditEventId'
    );
  END IF;

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
