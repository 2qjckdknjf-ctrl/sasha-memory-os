-- WP connector-sync: allow connector_sync jobs + enqueue stub for connected accounts

ALTER TABLE processing_jobs
  DROP CONSTRAINT IF EXISTS processing_jobs_job_type_check;

ALTER TABLE processing_jobs
  ADD CONSTRAINT processing_jobs_job_type_check
  CHECK (job_type IN (
    'parse', 'ocr', 'embed', 'extract', 'consolidate', 'ingest', 'connector_sync'
  ));

CREATE OR REPLACE FUNCTION app.api_enqueue_connector_sync(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_connection_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_conn RECORD;
  v_job_id uuid;
  v_event_id uuid;
  v_enqueued jsonb := '[]'::jsonb;
  v_count int := 0;
  v_idem text;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_conn IN
    SELECT a.*
    FROM connector_accounts a
    WHERE a.workspace_id = p_workspace_id
      AND a.status = 'connected'
      AND (p_connection_id IS NULL OR a.id = p_connection_id)
  LOOP
    v_idem := format(
      'connector-sync/%s/%s',
      v_conn.id::text,
      to_char(timezone('utc', now()), 'YYYYMMDDHH24MI')
    );

    INSERT INTO outbox_events (
      workspace_id, aggregate_type, aggregate_id, event_type, payload
    ) VALUES (
      p_workspace_id,
      'connector_account',
      v_conn.id,
      'connector.sync.requested',
      jsonb_build_object(
        'connectionId', v_conn.id,
        'connectorId', v_conn.connector_id,
        'displayName', v_conn.display_name,
        'requestedBy', p_subject_id,
        'mode', 'stub'
      )
    )
    RETURNING id INTO v_event_id;

    INSERT INTO processing_jobs (
      workspace_id, job_type, status, idempotency_key
    ) VALUES (
      p_workspace_id,
      'connector_sync',
      'queued',
      v_idem
    )
    ON CONFLICT (workspace_id, job_type, idempotency_key) DO NOTHING;

    SELECT id INTO v_job_id
    FROM processing_jobs
    WHERE workspace_id = p_workspace_id
      AND job_type = 'connector_sync'
      AND idempotency_key = v_idem;

    UPDATE outbox_events
    SET payload = payload || jsonb_build_object('jobId', v_job_id)
    WHERE id = v_event_id;

    v_enqueued := v_enqueued || jsonb_build_array(
      jsonb_build_object(
        'connectionId', v_conn.id,
        'connectorId', v_conn.connector_id,
        'jobId', v_job_id,
        'eventId', v_event_id,
        'idempotencyKey', v_idem
      )
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'enqueued', v_enqueued,
    'count', v_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_enqueue_connector_sync(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_connection_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_enqueue_connector_sync(
    p_secret, p_subject_id, p_workspace_id, p_connection_id
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_enqueue_connector_sync(text, uuid, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_enqueue_connector_sync(text, uuid, uuid, uuid)
  TO anon, authenticated, service_role;
