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

GRANT EXECUTE ON FUNCTION app.api_capture_connector_record(
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
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  jsonb,
  jsonb,
  boolean
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.api_capture_connector_record(
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
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  jsonb,
  jsonb,
  boolean
) TO anon, authenticated, service_role;

INSERT INTO connector_definitions (
  id,
  version,
  display_name,
  auth_type,
  capabilities,
  supports,
  storage_modes
)
VALUES (
  'apple',
  '1.0.0',
  'Apple companion',
  'device',
  '["device.push","share_extension","photos.selected.read","files.selected.read"]'::jsonb,
  '{"validate_scope":true,"initial_sync":true,"incremental_sync":true,"webhooks":false,"live_fetch":false,"write":false,"discover":false}'::jsonb,
  ARRAY['reference', 'indexed', 'archived']
)
ON CONFLICT (id) DO UPDATE
SET
  version = EXCLUDED.version,
  display_name = EXCLUDED.display_name,
  auth_type = EXCLUDED.auth_type,
  capabilities = EXCLUDED.capabilities,
  supports = EXCLUDED.supports,
  storage_modes = EXCLUDED.storage_modes;
