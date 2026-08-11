-- Extend api_capture_text with source filename/mime for document capture alpha

DROP FUNCTION IF EXISTS public.api_capture_text(text, uuid, uuid, uuid, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS app.api_capture_text(text, uuid, uuid, uuid, text, text, text, text, boolean);

CREATE OR REPLACE FUNCTION app.api_capture_text(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_title text,
  p_text text,
  p_idempotency_key text,
  p_sensitivity text DEFAULT 'internal',
  p_process_now boolean DEFAULT true,
  p_filename text DEFAULT NULL,
  p_mime_type text DEFAULT 'text/plain'
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
  v_event_type text := CASE
    WHEN p_filename IS NULL AND v_mime = 'text/plain' THEN 'capture.text.created'
    ELSE 'capture.document.created'
  END;
  v_outbox_type text := CASE
    WHEN p_filename IS NULL AND v_mime = 'text/plain' THEN 'capture.text.queued'
    ELSE 'capture.document.queued'
  END;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RAISE EXCEPTION 'text required';
  END IF;

  IF NOT app.has_acl(p_workspace_id, 'memory', 'write', p_project_id, p_sensitivity) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_checksum := encode(digest(convert_to(p_text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO source_events (
    workspace_id, project_id, provider, event_type, idempotency_key,
    observed_at, sensitivity, storage_mode, payload, content_checksum,
    created_by_subject
  ) VALUES (
    p_workspace_id,
    p_project_id,
    'manual',
    v_event_type,
    p_idempotency_key,
    now(),
    p_sensitivity,
    'indexed',
    jsonb_build_object(
      'title', p_title,
      'filename', p_filename,
      'mime_type', v_mime,
      'content', jsonb_build_object(
        'mime_type', v_mime,
        'text', p_text,
        'checksum', v_checksum
      ),
      'quarantine', true
    ),
    v_checksum,
    p_subject_id
  )
  ON CONFLICT (workspace_id, provider, idempotency_key) DO NOTHING;

  SELECT id INTO v_event_id
  FROM source_events
  WHERE workspace_id = p_workspace_id
    AND provider = 'manual'
    AND idempotency_key = p_idempotency_key;

  SELECT id INTO v_artifact_id
  FROM artifacts
  WHERE source_event_id = v_event_id
  LIMIT 1;

  IF v_artifact_id IS NULL THEN
    INSERT INTO artifacts (
      workspace_id, project_id, source_event_id, mime_type, storage_mode,
      storage_key, checksum_sha256, byte_size, version_label, metadata
    ) VALUES (
      p_workspace_id,
      p_project_id,
      v_event_id,
      v_mime,
      'indexed',
      format('quarantine/%s/%s', p_workspace_id, v_event_id),
      v_checksum,
      octet_length(p_text),
      '1',
      jsonb_build_object(
        'quarantine', true,
        'title', p_title,
        'text', p_text,
        'filename', p_filename,
        'source_mime_type', v_mime
      )
    )
    RETURNING id INTO v_artifact_id;
  END IF;

  INSERT INTO processing_jobs (
    workspace_id, job_type, status, source_event_id, idempotency_key
  ) VALUES (
    p_workspace_id, 'ingest', 'queued', v_event_id, p_idempotency_key
  )
  ON CONFLICT (workspace_id, job_type, idempotency_key) DO NOTHING;

  SELECT id INTO v_job_id
  FROM processing_jobs
  WHERE workspace_id = p_workspace_id
    AND job_type = 'ingest'
    AND idempotency_key = p_idempotency_key;

  INSERT INTO outbox_events (
    workspace_id, aggregate_type, aggregate_id, event_type, payload
  )
  SELECT
    p_workspace_id,
    'source_event',
    v_event_id,
    v_outbox_type,
    jsonb_build_object(
      'job_id', v_job_id,
      'artifact_id', v_artifact_id,
      'checksum', v_checksum,
      'filename', p_filename,
      'mime_type', v_mime
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM outbox_events o
    WHERE o.aggregate_id = v_event_id
      AND o.event_type = v_outbox_type
  );

  IF p_process_now THEN
    v_process := app.api_process_ingest_job(p_secret, p_subject_id, v_job_id);
  END IF;

  RETURN jsonb_build_object(
    'eventId', v_event_id,
    'artifactId', v_artifact_id,
    'jobId', v_job_id,
    'checksum', v_checksum,
    'filename', p_filename,
    'mimeType', v_mime,
    'process', v_process
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_capture_text(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_title text,
  p_text text,
  p_idempotency_key text,
  p_sensitivity text DEFAULT 'internal',
  p_process_now boolean DEFAULT true,
  p_filename text DEFAULT NULL,
  p_mime_type text DEFAULT 'text/plain'
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_capture_text(
    p_secret, p_subject_id, p_workspace_id, p_project_id,
    p_title, p_text, p_idempotency_key, p_sensitivity, p_process_now,
    p_filename, p_mime_type
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_capture_text(text, uuid, uuid, uuid, text, text, text, text, boolean, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_capture_text(text, uuid, uuid, uuid, text, text, text, text, boolean, text, text)
  TO anon, authenticated, service_role;
