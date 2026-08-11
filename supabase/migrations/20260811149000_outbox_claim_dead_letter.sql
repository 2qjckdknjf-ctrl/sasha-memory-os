-- List unpublished outbox + dead-letter stale processing jobs (cron / worker)

CREATE OR REPLACE FUNCTION app.api_list_outbox_pending(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_event_type text DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_rows jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(
    jsonb_agg(row_to_json(t)::jsonb ORDER BY t.ord),
    '[]'::jsonb
  )
  INTO v_rows
  FROM (
    SELECT
      o.id,
      o.workspace_id AS "workspaceId",
      o.aggregate_type AS "aggregateType",
      o.aggregate_id AS "aggregateId",
      o.event_type AS "eventType",
      o.payload,
      o.created_at AS "createdAt",
      o.attempts,
      o.last_error AS "lastError",
      row_number() OVER (ORDER BY o.created_at ASC) AS ord
    FROM outbox_events o
    WHERE o.workspace_id = p_workspace_id
      AND o.published_at IS NULL
      AND (p_event_type IS NULL OR o.event_type = btrim(p_event_type))
    ORDER BY o.created_at ASC
    LIMIT v_limit
  ) t;

  RETURN jsonb_build_object(
    'count', jsonb_array_length(v_rows),
    'events', v_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_list_outbox_pending(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_event_type text DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_list_outbox_pending(
    p_secret, p_subject_id, p_workspace_id, p_event_type, p_limit
  )
$$;

GRANT EXECUTE ON FUNCTION app.api_list_outbox_pending(text, uuid, uuid, text, int)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_list_outbox_pending(text, uuid, uuid, text, int)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.api_dead_letter_stale_jobs(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_older_than_minutes int DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_minutes int := greatest(1, coalesce(p_older_than_minutes, 60));
  v_cutoff timestamptz := now() - make_interval(mins => v_minutes);
  v_count int := 0;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH stale AS (
    SELECT id
    FROM processing_jobs
    WHERE workspace_id = p_workspace_id
      AND status IN ('queued', 'running')
      AND updated_at < v_cutoff
    FOR UPDATE SKIP LOCKED
  ),
  marked AS (
    UPDATE processing_jobs j
    SET
      status = 'dead_letter',
      error = coalesce(j.error, format('stale after %s minutes', v_minutes)),
      updated_at = now(),
      attempt = j.attempt + 1
    FROM stale
    WHERE j.id = stale.id
    RETURNING j.id
  ),
  outbox_mark AS (
    UPDATE outbox_events o
    SET
      attempts = o.attempts + 1,
      last_error = format('job dead_letter after %s minutes', v_minutes),
      published_at = coalesce(o.published_at, now())
    WHERE o.workspace_id = p_workspace_id
      AND o.published_at IS NULL
      AND o.payload ? 'jobId'
      AND (o.payload->>'jobId')::uuid IN (SELECT id FROM marked)
    RETURNING o.id
  )
  SELECT (SELECT count(*)::int FROM marked) INTO v_count;

  RETURN jsonb_build_object(
    'deadLettered', v_count,
    'olderThanMinutes', v_minutes,
    'cutoff', v_cutoff
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_dead_letter_stale_jobs(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_older_than_minutes int DEFAULT 60
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_dead_letter_stale_jobs(
    p_secret, p_subject_id, p_workspace_id, p_older_than_minutes
  )
$$;

GRANT EXECUTE ON FUNCTION app.api_dead_letter_stale_jobs(text, uuid, uuid, int)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_dead_letter_stale_jobs(text, uuid, uuid, int)
  TO anon, authenticated, service_role;
