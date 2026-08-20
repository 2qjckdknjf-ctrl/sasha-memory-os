CREATE TABLE roma_project_health_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  cadence_minutes integer NOT NULL
    CHECK (cadence_minutes BETWEEN 1 AND 10080),
  next_run_at timestamptz NOT NULL,
  last_enqueued_at timestamptz,
  last_period_start timestamptz,
  last_job_id uuid REFERENCES processing_jobs (id) ON DELETE SET NULL,
  last_error text,
  reason text NOT NULL DEFAULT 'Scheduled ROMA project-health summary for one explicit project.',
  disabled_at timestamptz,
  disabled_reason text,
  created_by_subject uuid REFERENCES subjects (id) ON DELETE SET NULL,
  updated_by_subject uuid REFERENCES subjects (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id)
);

CREATE INDEX roma_project_health_schedules_due_idx
  ON roma_project_health_schedules (workspace_id, next_run_at)
  WHERE disabled_at IS NULL;

ALTER TABLE roma_project_health_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY roma_project_health_schedules_select
  ON roma_project_health_schedules
  FOR SELECT
  USING (
    app.is_workspace_member(workspace_id)
    AND app.has_acl(workspace_id, 'project', 'read', project_id, 'internal')
  );

CREATE OR REPLACE FUNCTION app.assert_roma_project_health_schedule_access(
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
  v_project_exists boolean;
BEGIN
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
END;
$$;

CREATE OR REPLACE FUNCTION app.api_upsert_roma_project_health_schedule(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_cadence_minutes integer,
  p_enabled boolean DEFAULT NULL,
  p_next_run_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_existing roma_project_health_schedules%ROWTYPE;
  v_row roma_project_health_schedules%ROWTYPE;
  v_now timestamptz := now();
  v_cadence integer := coalesce(p_cadence_minutes, 0);
  v_reason text := nullif(btrim(p_reason), '');
  v_before jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF v_cadence < 1 OR v_cadence > 10080 THEN
    RAISE EXCEPTION 'cadence_minutes must be between 1 and 10080';
  END IF;

  PERFORM app.assert_roma_project_health_schedule_access(p_workspace_id, p_project_id);

  SELECT *
  INTO v_existing
  FROM roma_project_health_schedules
  WHERE workspace_id = p_workspace_id
    AND project_id = p_project_id
  FOR UPDATE;

  IF FOUND THEN
    v_before := jsonb_build_object(
      'scheduleId', v_existing.id,
      'projectId', v_existing.project_id,
      'cadenceMinutes', v_existing.cadence_minutes,
      'nextRunAt', v_existing.next_run_at,
      'enabled', v_existing.disabled_at IS NULL,
      'disabledAt', v_existing.disabled_at,
      'disabledReason', v_existing.disabled_reason,
      'reason', v_existing.reason
    );

    UPDATE roma_project_health_schedules
    SET
      cadence_minutes = v_cadence,
      next_run_at = CASE
        WHEN p_enabled IS TRUE THEN coalesce(
          p_next_run_at,
          CASE
            WHEN v_existing.disabled_at IS NULL THEN v_existing.next_run_at
            ELSE v_now
          END
        )
        ELSE coalesce(p_next_run_at, v_existing.next_run_at)
      END,
      reason = coalesce(v_reason, v_existing.reason),
      disabled_at = CASE
        WHEN p_enabled IS TRUE THEN NULL
        WHEN p_enabled IS FALSE THEN coalesce(v_existing.disabled_at, v_now)
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
    INSERT INTO roma_project_health_schedules (
      workspace_id,
      project_id,
      cadence_minutes,
      next_run_at,
      reason,
      disabled_at,
      disabled_reason,
      created_by_subject,
      updated_by_subject
    )
    VALUES (
      p_workspace_id,
      p_project_id,
      v_cadence,
      coalesce(p_next_run_at, v_now),
      coalesce(v_reason, 'Scheduled ROMA project-health summary for one explicit project.'),
      CASE WHEN coalesce(p_enabled, true) THEN NULL ELSE v_now END,
      CASE WHEN coalesce(p_enabled, true) THEN NULL ELSE 'disabled by operator' END,
      p_subject_id,
      p_subject_id
    )
    RETURNING * INTO v_row;
  END IF;

  PERFORM app.api_append_audit_event(
    p_secret,
    p_subject_id,
    p_workspace_id,
    'roma.project_health.schedule.upserted',
    'roma_project_health_schedule',
    v_row.id,
    v_row.reason,
    v_before,
    jsonb_build_object(
      'scheduleId', v_row.id,
      'projectId', v_row.project_id,
      'cadenceMinutes', v_row.cadence_minutes,
      'nextRunAt', v_row.next_run_at,
      'enabled', v_row.disabled_at IS NULL,
      'disabledAt', v_row.disabled_at,
      'disabledReason', v_row.disabled_reason,
      'reason', v_row.reason
    )
  );

  RETURN jsonb_build_object(
    'scheduleId', v_row.id,
    'workspaceId', v_row.workspace_id,
    'projectId', v_row.project_id,
    'cadenceMinutes', v_row.cadence_minutes,
    'nextRunAt', v_row.next_run_at,
    'lastEnqueuedAt', v_row.last_enqueued_at,
    'lastPeriodStart', v_row.last_period_start,
    'lastJobId', v_row.last_job_id,
    'lastError', v_row.last_error,
    'enabled', v_row.disabled_at IS NULL,
    'disabledAt', v_row.disabled_at,
    'disabledReason', v_row.disabled_reason,
    'reason', v_row.reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_upsert_roma_project_health_schedule(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_cadence_minutes integer,
  p_enabled boolean DEFAULT NULL,
  p_next_run_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_upsert_roma_project_health_schedule(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_project_id,
    p_cadence_minutes,
    p_enabled,
    p_next_run_at,
    p_reason
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_upsert_roma_project_health_schedule(text, uuid, uuid, uuid, integer, boolean, timestamptz, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_upsert_roma_project_health_schedule(text, uuid, uuid, uuid, integer, boolean, timestamptz, text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.api_tick_roma_project_health_schedules(
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
  v_now timestamptz := now();
  v_schedule roma_project_health_schedules%ROWTYPE;
  v_before jsonb;
  v_enqueue jsonb;
  v_next_run_at timestamptz;
  v_period_start timestamptz;
  v_job_id uuid;
  v_inserted boolean;
  v_skipped integer;
  v_message text;
  v_enqueued jsonb := '[]'::jsonb;
  v_disabled jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_subject_id <> v_roma_subject THEN
    RAISE EXCEPTION 'roma subject required' USING ERRCODE = '42501';
  END IF;

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_schedule IN
    SELECT *
    FROM roma_project_health_schedules
    WHERE workspace_id = p_workspace_id
      AND disabled_at IS NULL
      AND next_run_at <= v_now
      AND (p_project_id IS NULL OR project_id = p_project_id)
    ORDER BY next_run_at ASC, created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_period_start := v_schedule.next_run_at;
    v_next_run_at := v_period_start + make_interval(mins => v_schedule.cadence_minutes);
    v_skipped := 0;
    WHILE v_next_run_at <= v_now LOOP
      v_next_run_at := v_next_run_at + make_interval(mins => v_schedule.cadence_minutes);
      v_skipped := v_skipped + 1;
    END LOOP;

    v_before := jsonb_build_object(
      'scheduleId', v_schedule.id,
      'projectId', v_schedule.project_id,
      'cadenceMinutes', v_schedule.cadence_minutes,
      'nextRunAt', v_schedule.next_run_at,
      'enabled', v_schedule.disabled_at IS NULL,
      'reason', v_schedule.reason
    );

    BEGIN
      PERFORM app.assert_roma_project_health_schedule_access(
        v_schedule.workspace_id,
        v_schedule.project_id
      );

      v_enqueue := app.api_enqueue_roma_project_health(
        p_secret,
        p_subject_id,
        v_schedule.workspace_id,
        v_schedule.project_id,
        format(
          'schedule/%s/%s',
          v_schedule.id::text,
          to_char(timezone('utc', v_period_start), 'YYYYMMDDHH24MI')
        ),
        v_schedule.reason
      );
      v_job_id := (v_enqueue->>'jobId')::uuid;
      v_inserted := coalesce((v_enqueue->>'inserted')::boolean, false);

      UPDATE roma_project_health_schedules
      SET
        next_run_at = v_next_run_at,
        last_enqueued_at = v_now,
        last_period_start = v_period_start,
        last_job_id = v_job_id,
        last_error = NULL,
        updated_at = v_now,
        updated_by_subject = p_subject_id
      WHERE id = v_schedule.id;

      PERFORM app.api_append_audit_event(
        p_secret,
        p_subject_id,
        v_schedule.workspace_id,
        'roma.project_health.schedule.enqueued',
        'roma_project_health_schedule',
        v_schedule.id,
        v_schedule.reason,
        v_before,
        jsonb_build_object(
          'scheduleId', v_schedule.id,
          'projectId', v_schedule.project_id,
          'periodStart', v_period_start,
          'nextRunAt', v_next_run_at,
          'jobId', v_job_id,
          'inserted', v_inserted,
          'skippedIntervals', v_skipped,
          'requestedBy', p_subject_id,
          'executionSubjectId', v_roma_subject
        )
      );

      v_enqueued := v_enqueued || jsonb_build_array(
        jsonb_build_object(
          'scheduleId', v_schedule.id,
          'projectId', v_schedule.project_id,
          'periodStart', v_period_start,
          'nextRunAt', v_next_run_at,
          'jobId', v_job_id,
          'inserted', v_inserted,
          'skippedIntervals', v_skipped,
          'idempotencyKey', v_enqueue->>'idempotencyKey'
        )
      );
    EXCEPTION
      WHEN SQLSTATE '42501' OR SQLSTATE 'P0002' THEN
        v_message := SQLERRM;

        UPDATE roma_project_health_schedules
        SET
          disabled_at = coalesce(disabled_at, v_now),
          disabled_reason = v_message,
          last_error = v_message,
          updated_at = v_now,
          updated_by_subject = p_subject_id
        WHERE id = v_schedule.id;

        PERFORM app.api_append_audit_event(
          p_secret,
          p_subject_id,
          v_schedule.workspace_id,
          'roma.project_health.schedule.disabled',
          'roma_project_health_schedule',
          v_schedule.id,
          v_message,
          v_before,
          jsonb_build_object(
            'scheduleId', v_schedule.id,
            'projectId', v_schedule.project_id,
            'disabledAt', v_now,
            'disabledReason', v_message
          )
        );

        v_disabled := v_disabled || jsonb_build_array(
          jsonb_build_object(
            'scheduleId', v_schedule.id,
            'projectId', v_schedule.project_id,
            'error', v_message
          )
        );
      WHEN OTHERS THEN
        v_message := SQLERRM;

        UPDATE roma_project_health_schedules
        SET
          last_error = v_message,
          updated_at = v_now,
          updated_by_subject = p_subject_id
        WHERE id = v_schedule.id;

        PERFORM app.api_append_audit_event(
          p_secret,
          p_subject_id,
          v_schedule.workspace_id,
          'roma.project_health.schedule.tick_failed',
          'roma_project_health_schedule',
          v_schedule.id,
          v_message,
          v_before,
          jsonb_build_object(
            'scheduleId', v_schedule.id,
            'projectId', v_schedule.project_id,
            'error', v_message
          )
        );

        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object(
            'scheduleId', v_schedule.id,
            'projectId', v_schedule.project_id,
            'error', v_message
          )
        );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'count',
    jsonb_array_length(v_enqueued) + jsonb_array_length(v_disabled) + jsonb_array_length(v_errors),
    'enqueued', v_enqueued,
    'disabled', v_disabled,
    'errors', v_errors
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_tick_roma_project_health_schedules(
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
  SELECT app.api_tick_roma_project_health_schedules(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_limit,
    p_project_id
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_tick_roma_project_health_schedules(text, uuid, uuid, integer, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_tick_roma_project_health_schedules(text, uuid, uuid, integer, uuid)
  TO anon, authenticated, service_role;
