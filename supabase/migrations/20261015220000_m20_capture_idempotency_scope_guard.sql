-- M20.3: serialize capture idempotency and reject cross-scope/payload replay.

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
  v_event source_events%ROWTYPE;
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
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency key required';
  END IF;

  IF NOT app.has_acl(p_workspace_id, 'memory', 'write', p_project_id, p_sensitivity) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_checksum := encode(digest(convert_to(p_text, 'UTF8'), 'sha256'), 'hex');

  -- The source-event uniqueness constraint serializes the initial insert, but
  -- an explicit lock also keeps artifact/job/outbox receipt creation inside one
  -- deterministic critical section for every retry of the same key.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_workspace_id::text || ':manual:' || p_idempotency_key,
      0
    )
  );

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

  SELECT * INTO STRICT v_event
  FROM source_events
  WHERE workspace_id = p_workspace_id
    AND provider = 'manual'
    AND idempotency_key = p_idempotency_key;
  v_event_id := v_event.id;

  IF v_event.project_id IS DISTINCT FROM p_project_id
    OR v_event.event_type IS DISTINCT FROM v_event_type
    OR v_event.sensitivity IS DISTINCT FROM p_sensitivity
    OR v_event.content_checksum IS DISTINCT FROM v_checksum
    OR v_event.created_by_subject IS DISTINCT FROM p_subject_id
    OR (v_event.payload->>'title') IS DISTINCT FROM p_title
    OR (v_event.payload->>'filename') IS DISTINCT FROM p_filename
    OR (v_event.payload->>'mime_type') IS DISTINCT FROM v_mime
  THEN
    RAISE EXCEPTION 'idempotency key conflict: capture scope or payload mismatch'
      USING ERRCODE = '22023';
  END IF;

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

REVOKE ALL ON FUNCTION app.api_capture_text(
  text, uuid, uuid, uuid, text, text, text, text, boolean, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_capture_text(
  text, uuid, uuid, uuid, text, text, text, text, boolean, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.api_capture_text(
  text, uuid, uuid, uuid, text, text, text, text, boolean, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_capture_text(
  text, uuid, uuid, uuid, text, text, text, text, boolean, text, text
) TO service_role;

-- Bound the authoritative ACL/ranking query before JSON aggregation so both
-- database work and database-to-Edge transfer have deterministic ceilings.
CREATE OR REPLACE FUNCTION app.api_search_memories_bounded(
  p_secret text,
  p_subject_id uuid,
  p_query text,
  p_project_id uuid DEFAULT NULL,
  p_include_history boolean DEFAULT false,
  p_query_embedding jsonb DEFAULT NULL,
  p_recorded_after timestamptz DEFAULT NULL,
  p_recorded_before timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_query text := coalesce(p_query, '');
  v_has_query boolean := btrim(v_query) <> '';
  v_query_vec vector(32);
  v_query_vec_hq vector(1536);
  v_qdims int := 0;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_recorded_after IS NOT NULL
     AND p_recorded_before IS NOT NULL
     AND p_recorded_after > p_recorded_before THEN
    RAISE EXCEPTION 'recorded_after must be <= recorded_before';
  END IF;

  IF p_query_embedding IS NOT NULL
     AND jsonb_typeof(p_query_embedding) = 'array' THEN
    v_qdims := jsonb_array_length(p_query_embedding);
    IF v_qdims = 32 THEN
      v_query_vec := (
        SELECT array_agg(value::text::float4 ORDER BY ordinality)::vector(32)
        FROM jsonb_array_elements(p_query_embedding) WITH ORDINALITY AS t(value, ordinality)
      );
    ELSIF v_qdims = 1536 THEN
      v_query_vec_hq := (
        SELECT array_agg(value::text::float4 ORDER BY ordinality)::vector(1536)
        FROM jsonb_array_elements(p_query_embedding) WITH ORDINALITY AS t(value, ordinality)
      );
    END IF;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(hit ORDER BY (hit->>'score')::float8 DESC)
    FROM (
      SELECT candidate.hit
      FROM (
        SELECT jsonb_build_object(
          'memory', (
            to_jsonb(m) || jsonb_build_object(
              'project_id', effective_project.effective_project_id,
              'stored_project_id', m.project_id,
              'effective_project_id', effective_project.effective_project_id
            )
          ),
          'score',
            (
              LEAST(
                1.0,
                GREATEST(0.0, m.importance + coalesce(pref.importance_delta, 0.0))
              )
              * m.confidence
            )
            * CASE m.status
                WHEN 'verified' THEN 1.15
                WHEN 'active' THEN 1.08
                WHEN 'candidate' THEN 1.0
                WHEN 'disputed' THEN 0.7
                ELSE 0.5
              END
            * CASE
                WHEN pref.pinned THEN 1.75
                ELSE 1.0
              END
            * CASE
                WHEN NOT v_has_query THEN 1.0
                WHEN m.title ILIKE '%' || v_query || '%'
                  OR m.content ILIKE '%' || v_query || '%' THEN 1.0
                ELSE 0.6
              END
            * CASE
                WHEN v_query_vec_hq IS NOT NULL AND m.embedding_vector_hq IS NOT NULL THEN
                  0.7 + 0.3 * greatest(0.0, 1.0 - (m.embedding_vector_hq <=> v_query_vec_hq))
                WHEN v_query_vec IS NOT NULL AND m.embedding_vector IS NOT NULL THEN
                  0.7 + 0.3 * greatest(0.0, 1.0 - (m.embedding_vector <=> v_query_vec))
                ELSE 1.0
              END,
          'reason',
            CASE
              WHEN v_query_vec_hq IS NOT NULL AND m.embedding_vector_hq IS NOT NULL
                THEN 'hybrid:sql+vector-hq'
              WHEN v_query_vec IS NOT NULL AND m.embedding_vector IS NOT NULL
                THEN 'hybrid:sql+vector'
              ELSE 'structured+text'
            END,
          'personalization',
            CASE
              WHEN pref.scope IS NULL THEN NULL
              ELSE jsonb_build_object(
                'memoryId', m.id,
                'projectId', effective_project.effective_project_id,
                'storedProjectId', m.project_id,
                'scope', pref.scope,
                'actorSubjectId', pref.actor_subject_id,
                'pinned', pref.pinned,
                'importanceDelta', coalesce(pref.importance_delta, 0.0),
                'rankingVersion', pref.ranking_version,
                'version', pref.version
              )
            END
        ) AS hit
        FROM memory_records m
        CROSS JOIN LATERAL (
          SELECT app.effective_memory_project_id(m.id) AS effective_project_id
        ) effective_project
        LEFT JOIN LATERAL (
          SELECT
            mp.scope,
            mp.actor_subject_id,
            mp.pinned,
            mp.importance_delta,
            mp.ranking_version,
            mp.version
          FROM memory_personalizations mp
          WHERE mp.workspace_id = m.workspace_id
            AND mp.project_id = effective_project.effective_project_id
            AND mp.memory_id = m.id
            AND (
              (mp.scope = 'actor' AND mp.actor_subject_id = p_subject_id)
              OR mp.scope = 'project_default'
            )
          ORDER BY
            CASE WHEN mp.scope = 'actor' THEN 0 ELSE 1 END,
            mp.version DESC
          LIMIT 1
        ) pref ON true
        WHERE (
            p_project_id IS NULL
            OR effective_project.effective_project_id = p_project_id
          )
          AND (
            p_include_history
            OR m.status IN ('active', 'verified', 'candidate')
          )
          AND (p_recorded_after IS NULL OR m.recorded_at >= p_recorded_after)
          AND (p_recorded_before IS NULL OR m.recorded_at <= p_recorded_before)
          AND app.has_acl(
            m.workspace_id,
            'memory',
            'read',
            effective_project.effective_project_id,
            m.sensitivity
          )
          AND (
            NOT v_has_query
            OR m.title ILIKE '%' || v_query || '%'
            OR m.content ILIKE '%' || v_query || '%'
            OR (
              v_query_vec_hq IS NOT NULL
              AND m.embedding_vector_hq IS NOT NULL
              AND (m.embedding_vector_hq <=> v_query_vec_hq) < 0.55
            )
            OR (
              v_query_vec IS NOT NULL
              AND m.embedding_vector IS NOT NULL
              AND (m.embedding_vector <=> v_query_vec) < 0.55
            )
          )
      ) candidate
      ORDER BY (candidate.hit->>'score')::float8 DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50)
    ) ranked
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_search_memories_bounded(
  p_secret text,
  p_subject_id uuid,
  p_query text,
  p_project_id uuid DEFAULT NULL,
  p_include_history boolean DEFAULT false,
  p_query_embedding jsonb DEFAULT NULL,
  p_recorded_after timestamptz DEFAULT NULL,
  p_recorded_before timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_search_memories_bounded(
    p_secret,
    p_subject_id,
    p_query,
    p_project_id,
    p_include_history,
    p_query_embedding,
    p_recorded_after,
    p_recorded_before,
    p_limit
  );
$$;

REVOKE ALL ON FUNCTION app.api_search_memories_bounded(
  text, uuid, text, uuid, boolean, jsonb, timestamptz, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_search_memories_bounded(
  text, uuid, text, uuid, boolean, jsonb, timestamptz, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.api_search_memories_bounded(
  text, uuid, text, uuid, boolean, jsonb, timestamptz, timestamptz, integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_search_memories_bounded(
  text, uuid, text, uuid, boolean, jsonb, timestamptz, timestamptz, integer
) TO service_role;
