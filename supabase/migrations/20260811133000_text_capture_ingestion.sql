-- WP-04 alpha: manual text capture → artifact chunks → candidate memory

CREATE TABLE artifact_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  content text NOT NULL,
  char_start integer NOT NULL DEFAULT 0,
  char_end integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, chunk_index)
);

CREATE INDEX idx_artifact_chunks_artifact ON artifact_chunks (artifact_id);

ALTER TABLE artifact_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_chunks FORCE ROW LEVEL SECURITY;

CREATE POLICY artifact_chunks_select ON artifact_chunks
  FOR SELECT USING (app.has_acl(workspace_id, 'artifact', 'read', NULL));

CREATE POLICY artifact_chunks_insert ON artifact_chunks
  FOR INSERT WITH CHECK (app.has_acl(workspace_id, 'artifact', 'write', NULL));

CREATE OR REPLACE FUNCTION app.chunk_text(p_text text, p_size integer DEFAULT 1200)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, app
AS $$
DECLARE
  v_chunks jsonb := '[]'::jsonb;
  v_len integer := char_length(p_text);
  v_pos integer := 1;
  v_idx integer := 0;
  v_end integer;
  v_piece text;
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN v_chunks;
  END IF;

  IF v_len <= p_size THEN
    RETURN jsonb_build_array(jsonb_build_object(
      'index', 0,
      'content', p_text,
      'char_start', 0,
      'char_end', v_len
    ));
  END IF;

  WHILE v_pos <= v_len LOOP
    v_end := least(v_pos + p_size - 1, v_len);
    v_piece := substr(p_text, v_pos, v_end - v_pos + 1);
    v_chunks := v_chunks || jsonb_build_array(jsonb_build_object(
      'index', v_idx,
      'content', v_piece,
      'char_start', v_pos - 1,
      'char_end', v_end
    ));
    v_idx := v_idx + 1;
    v_pos := v_end + 1;
  END LOOP;

  RETURN v_chunks;
END;
$$;

CREATE OR REPLACE FUNCTION app.api_process_ingest_job(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_job processing_jobs%ROWTYPE;
  v_event source_events%ROWTYPE;
  v_artifact artifacts%ROWTYPE;
  v_text text;
  v_title text;
  v_chunks jsonb;
  v_chunk jsonb;
  v_memory_id uuid;
  v_existing uuid;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT * INTO v_job FROM processing_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  IF v_job.status = 'succeeded' THEN
    SELECT id INTO v_memory_id
    FROM memory_records
    WHERE source_event_id = v_job.source_event_id
      AND memory_type = 'fact'
    LIMIT 1;
    RETURN jsonb_build_object(
      'job', to_jsonb(v_job),
      'memoryId', v_memory_id,
      'idempotent', true
    );
  END IF;

  IF v_job.status NOT IN ('queued', 'running', 'failed') THEN
    RAISE EXCEPTION 'job not processable: %', v_job.status;
  END IF;

  UPDATE processing_jobs
  SET status = 'running', attempt = attempt + 1, updated_at = now(), error = NULL
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  SELECT * INTO v_event FROM source_events WHERE id = v_job.source_event_id;
  IF NOT FOUND THEN
    UPDATE processing_jobs
    SET status = 'failed', error = 'missing source event', updated_at = now()
    WHERE id = p_job_id;
    RAISE EXCEPTION 'missing source event';
  END IF;

  IF NOT app.has_acl(
    v_event.workspace_id, 'memory', 'write', v_event.project_id, v_event.sensitivity
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_artifact
  FROM artifacts
  WHERE source_event_id = v_event.id
  ORDER BY created_at
  LIMIT 1;

  v_text := coalesce(
    v_event.payload #>> '{content,text}',
    v_artifact.metadata ->> 'text',
    ''
  );
  v_title := coalesce(
    v_event.payload ->> 'title',
    left(btrim(v_text), 80),
    'Captured note'
  );

  IF btrim(v_text) = '' THEN
    UPDATE processing_jobs
    SET status = 'failed', error = 'empty text payload', updated_at = now()
    WHERE id = p_job_id;
    RAISE EXCEPTION 'empty text payload';
  END IF;

  DELETE FROM artifact_chunks WHERE artifact_id = v_artifact.id;
  v_chunks := app.chunk_text(v_text, 1200);

  FOR v_chunk IN SELECT * FROM jsonb_array_elements(v_chunks)
  LOOP
    INSERT INTO artifact_chunks (
      workspace_id, artifact_id, chunk_index, content, char_start, char_end
    ) VALUES (
      v_event.workspace_id,
      v_artifact.id,
      (v_chunk ->> 'index')::integer,
      v_chunk ->> 'content',
      (v_chunk ->> 'char_start')::integer,
      (v_chunk ->> 'char_end')::integer
    );
  END LOOP;

  SELECT id INTO v_existing
  FROM memory_records
  WHERE source_event_id = v_event.id AND memory_type = 'fact'
  LIMIT 1;

  IF v_existing IS NULL THEN
    INSERT INTO memory_records (
      workspace_id, project_id, memory_type, title, content, status,
      importance, confidence, sensitivity, observed_at,
      source_event_id, created_by_subject, metadata
    ) VALUES (
      v_event.workspace_id,
      v_event.project_id,
      'fact',
      v_title,
      v_text,
      'candidate',
      0.55,
      0.6,
      v_event.sensitivity,
      v_event.observed_at,
      v_event.id,
      p_subject_id,
      jsonb_build_object(
        'capture', true,
        'needs_review', true,
        'chunk_count', jsonb_array_length(v_chunks)
      )
    )
    RETURNING id INTO v_memory_id;

    INSERT INTO memory_evidence (memory_id, source_event_id, workspace_id, evidence_span)
    VALUES (
      v_memory_id,
      v_event.id,
      v_event.workspace_id,
      jsonb_build_object('kind', 'full_text', 'artifact_id', v_artifact.id)
    );
  ELSE
    v_memory_id := v_existing;
  END IF;

  UPDATE artifacts
  SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'quarantine', false,
    'processed_at', now(),
    'chunk_count', jsonb_array_length(v_chunks)
  )
  WHERE id = v_artifact.id;

  UPDATE processing_jobs
  SET status = 'succeeded', updated_at = now(), error = NULL
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  INSERT INTO outbox_events (
    workspace_id, aggregate_type, aggregate_id, event_type, payload
  ) VALUES (
    v_event.workspace_id,
    'processing_job',
    v_job.id,
    'ingest.succeeded',
    jsonb_build_object(
      'job_id', v_job.id,
      'memory_id', v_memory_id,
      'artifact_id', v_artifact.id
    )
  );

  RETURN jsonb_build_object(
    'job', to_jsonb(v_job),
    'memoryId', v_memory_id,
    'artifactId', v_artifact.id,
    'chunkCount', jsonb_array_length(v_chunks),
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.api_capture_text(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_title text,
  p_text text,
  p_idempotency_key text,
  p_sensitivity text DEFAULT 'internal',
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
    'capture.text.created',
    p_idempotency_key,
    now(),
    p_sensitivity,
    'indexed',
    jsonb_build_object(
      'title', p_title,
      'content', jsonb_build_object(
        'mime_type', 'text/plain',
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
      'text/plain',
      'indexed',
      format('quarantine/%s/%s.txt', p_workspace_id, v_event_id),
      v_checksum,
      octet_length(p_text),
      '1',
      jsonb_build_object(
        'quarantine', true,
        'title', p_title,
        'text', p_text
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
    'capture.text.queued',
    jsonb_build_object(
      'job_id', v_job_id,
      'artifact_id', v_artifact_id,
      'checksum', v_checksum
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM outbox_events o
    WHERE o.aggregate_id = v_event_id
      AND o.event_type = 'capture.text.queued'
  );

  IF p_process_now THEN
    v_process := app.api_process_ingest_job(p_secret, p_subject_id, v_job_id);
  END IF;

  RETURN jsonb_build_object(
    'eventId', v_event_id,
    'artifactId', v_artifact_id,
    'jobId', v_job_id,
    'checksum', v_checksum,
    'process', v_process
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.api_get_job(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_job processing_jobs%ROWTYPE;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT * INTO v_job FROM processing_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT app.is_workspace_member(v_job.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN to_jsonb(v_job);
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
  p_process_now boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_capture_text(
    p_secret, p_subject_id, p_workspace_id, p_project_id,
    p_title, p_text, p_idempotency_key, p_sensitivity, p_process_now
  );
$$;

CREATE OR REPLACE FUNCTION public.api_process_ingest_job(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_process_ingest_job(p_secret, p_subject_id, p_job_id);
$$;

CREATE OR REPLACE FUNCTION public.api_get_job(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_get_job(p_secret, p_subject_id, p_job_id);
$$;

GRANT EXECUTE ON FUNCTION app.api_capture_text(text, uuid, uuid, uuid, text, text, text, text, boolean)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_capture_text(text, uuid, uuid, uuid, text, text, text, text, boolean)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_process_ingest_job(text, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_process_ingest_job(text, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_get_job(text, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_get_job(text, uuid, uuid)
  TO anon, authenticated, service_role;
