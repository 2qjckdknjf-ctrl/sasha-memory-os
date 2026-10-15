-- M20.4: production privacy/compliance operations.
--
-- Adds owner-only export, request execution, source-account revocation and
-- bounded retention. Operational audit rows contain identifiers/counts only;
-- memory bodies, source payloads, request reasons, corrections and tokens are
-- never copied into audit/ops state.

ALTER TABLE public.privacy_requests
  DROP CONSTRAINT IF EXISTS privacy_requests_status_check;

ALTER TABLE public.privacy_requests
  ADD CONSTRAINT privacy_requests_status_check
  CHECK (status IN ('submitted', 'processing', 'completed', 'failed'));

ALTER TABLE public.privacy_requests
  ADD COLUMN IF NOT EXISTS target_connector_account_id uuid
    REFERENCES public.connector_accounts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS failure_code text;

CREATE INDEX IF NOT EXISTS idx_privacy_requests_target_connector
  ON public.privacy_requests (target_connector_account_id)
  WHERE target_connector_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app.api_create_privacy_request_v2(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_request_type text,
  p_target_memory_id uuid DEFAULT NULL,
  p_target_connector_account_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_correction_text text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, vault, extensions
AS $$
DECLARE
  v_id uuid;
  v_existing public.privacy_requests%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_correction text := nullif(btrim(coalesce(p_correction_text, '')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL THEN RAISE EXCEPTION 'project_id required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'project not found in workspace' USING ERRCODE = 'P0002';
  END IF;
  IF p_request_type NOT IN ('deletion', 'correction', 'retraction') THEN
    RAISE EXCEPTION 'invalid privacy request type: %', p_request_type;
  END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'reason required'; END IF;
  IF v_key IS NULL THEN RAISE EXCEPTION 'idempotency key required'; END IF;
  IF p_request_type IN ('correction', 'retraction') AND p_target_memory_id IS NULL THEN
    RAISE EXCEPTION 'target_memory_id required for %', p_request_type;
  END IF;
  IF p_request_type = 'correction' AND v_correction IS NULL THEN
    RAISE EXCEPTION 'correction_text required for correction';
  END IF;
  IF p_request_type = 'deletion'
     AND p_target_memory_id IS NULL
     AND p_target_connector_account_id IS NULL THEN
    RAISE EXCEPTION 'deletion requires a memory or connector target';
  END IF;

  IF p_target_memory_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.memory_records m
    WHERE m.id = p_target_memory_id
      AND m.workspace_id = p_workspace_id
      AND app.effective_memory_project_id(m.id) = p_project_id
  ) THEN
    RAISE EXCEPTION 'memory target not found in project' USING ERRCODE = 'P0002';
  END IF;
  IF p_target_connector_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.connector_accounts c
    WHERE c.id = p_target_connector_account_id
      AND c.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'connector target not found in workspace' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_existing
  FROM public.privacy_requests r
  WHERE r.workspace_id = p_workspace_id AND r.idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.project_id IS DISTINCT FROM p_project_id
       OR v_existing.actor_subject_id IS DISTINCT FROM p_subject_id
       OR v_existing.request_type <> p_request_type
       OR v_existing.target_memory_id IS DISTINCT FROM p_target_memory_id
       OR v_existing.target_connector_account_id IS DISTINCT FROM p_target_connector_account_id
       OR (
         v_existing.status IN ('submitted', 'processing')
         AND (
           v_existing.reason IS DISTINCT FROM v_reason
           OR v_existing.correction_text IS DISTINCT FROM v_correction
         )
       ) THEN
      RAISE EXCEPTION 'idempotency key conflict';
    END IF;
    v_id := v_existing.id;
  ELSE
    INSERT INTO public.privacy_requests (
      workspace_id, project_id, actor_subject_id, request_type, status,
      target_memory_id, target_connector_account_id, reason, correction_text,
      idempotency_key
    ) VALUES (
      p_workspace_id, p_project_id, p_subject_id, p_request_type, 'submitted',
      p_target_memory_id, p_target_connector_account_id, v_reason, v_correction,
      v_key
    ) RETURNING id INTO v_id;

    INSERT INTO public.audit_log (
      workspace_id, actor_subject_id, action, object_type, object_id, reason,
      after_state
    ) VALUES (
      p_workspace_id, p_subject_id, 'privacy.request.submitted',
      'privacy_request', v_id, 'privacy request submitted',
      jsonb_strip_nulls(jsonb_build_object(
        'requestType', p_request_type,
        'projectId', p_project_id,
        'targetMemoryId', p_target_memory_id,
        'targetConnectorAccountId', p_target_connector_account_id,
        'status', 'submitted'
      ))
    );
  END IF;

  RETURN (
    SELECT jsonb_strip_nulls(jsonb_build_object(
      'id', r.id,
      'workspaceId', r.workspace_id,
      'projectId', r.project_id,
      'actorSubjectId', r.actor_subject_id,
      'requestType', r.request_type,
      'status', r.status,
      'targetMemoryId', r.target_memory_id,
      'targetConnectorAccountId', r.target_connector_account_id,
      'reason', r.reason,
      'correctionText', r.correction_text,
      'createdAt', r.created_at,
      'completedAt', r.completed_at,
      'resultSummary', r.result_summary
    )) FROM public.privacy_requests r WHERE r.id = v_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_create_privacy_request_v2(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_request_type text,
  p_target_memory_id uuid DEFAULT NULL,
  p_target_connector_account_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_correction_text text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, vault, extensions
AS $$
  SELECT app.api_create_privacy_request_v2(
    p_secret, p_subject_id, p_workspace_id, p_project_id, p_request_type,
    p_target_memory_id, p_target_connector_account_id, p_reason,
    p_correction_text, p_idempotency_key
  );
$$;

CREATE OR REPLACE FUNCTION app.api_list_privacy_requests(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'requests', coalesce((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', r.id,
        'workspaceId', r.workspace_id,
        'projectId', r.project_id,
        'actorSubjectId', r.actor_subject_id,
        'actor', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', s.id, 'externalKey', s.external_key,
          'displayName', s.display_name, 'kind', s.kind
        ) END,
        'requestType', r.request_type,
        'status', r.status,
        'targetMemoryId', r.target_memory_id,
        'targetConnectorAccountId', r.target_connector_account_id,
        'reason', r.reason,
        'correctionText', r.correction_text,
        'createdAt', r.created_at,
        'completedAt', r.completed_at,
        'resultSummary', r.result_summary,
        'failureCode', r.failure_code
      )) ORDER BY r.created_at DESC)
      FROM (
        SELECT * FROM public.privacy_requests
        WHERE workspace_id = p_workspace_id
        ORDER BY created_at DESC LIMIT v_limit
      ) r
      LEFT JOIN public.subjects s ON s.id = r.actor_subject_id
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.api_export_project_privacy_bundle(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 500));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_memory_count integer;
  v_source_count integer;
  v_artifact_count integer;
  v_connector_count integer;
  v_request_count integer;
  v_max_count integer;
  v_bundle jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL THEN RAISE EXCEPTION 'project_id required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'project not found in workspace' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_memory_count FROM public.memory_records m
  WHERE m.workspace_id = p_workspace_id
    AND app.effective_memory_project_id(m.id) = p_project_id;
  SELECT count(*) INTO v_source_count FROM public.source_events s
  WHERE s.workspace_id = p_workspace_id AND s.project_id = p_project_id;
  SELECT count(*) INTO v_artifact_count FROM public.artifacts a
  WHERE a.workspace_id = p_workspace_id AND a.project_id = p_project_id;
  SELECT count(*) INTO v_connector_count FROM public.connector_accounts c
  WHERE c.workspace_id = p_workspace_id
    AND EXISTS (
      SELECT 1 FROM public.source_events s
      WHERE s.connector_account_id = c.id AND s.project_id = p_project_id
    );
  SELECT count(*) INTO v_request_count FROM public.privacy_requests r
  WHERE r.workspace_id = p_workspace_id AND r.project_id = p_project_id;
  v_max_count := greatest(
    v_memory_count, v_source_count, v_artifact_count, v_connector_count,
    v_request_count
  );

  SELECT jsonb_build_object(
    'format', 'memory-os.privacy-export.v1',
    'exportedAt', now(),
    'workspaceId', p_workspace_id,
    'projectId', p_project_id,
    'subjectId', p_subject_id,
    'counts', jsonb_build_object(
      'memories', v_memory_count,
      'sourceEvents', v_source_count,
      'artifacts', v_artifact_count,
      'connectorAccounts', v_connector_count,
      'privacyRequests', v_request_count
    ),
    'truncated', jsonb_build_object(
      'memories', v_memory_count > v_offset + v_limit,
      'sourceEvents', v_source_count > v_offset + v_limit,
      'artifacts', v_artifact_count > v_offset + v_limit,
      'connectorAccounts', v_connector_count > v_offset + v_limit,
      'privacyRequests', v_request_count > v_offset + v_limit
    ),
    'pagination', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'nextOffset', CASE
        WHEN v_offset + v_limit < v_max_count THEN v_offset + v_limit
        ELSE NULL
      END,
      'hasMore', v_offset + v_limit < v_max_count
    ),
    'retentionPolicy', jsonb_build_object(
      'version', 'm20-s04-v1',
      'candidateMemoryDays', 90,
      'quarantineArtifactDays', 180,
      'publishedOutboxDays', 30,
      'deadLetterDays', 90,
      'auditDays', 365
    ),
    'memories', coalesce((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', m.id,
        'workspaceId', m.workspace_id,
        'projectId', app.effective_memory_project_id(m.id),
        'storedProjectId', m.project_id,
        'memoryType', m.memory_type,
        'title', m.title,
        'content', m.content,
        'status', m.status,
        'importance', m.importance,
        'confidence', m.confidence,
        'sensitivity', m.sensitivity,
        'validFrom', m.valid_from,
        'validTo', m.valid_to,
        'observedAt', m.observed_at,
        'recordedAt', m.recorded_at,
        'supersededBy', m.superseded_by,
        'sourceEventId', m.source_event_id,
        'createdBySubject', m.created_by_subject,
        'schemaVersion', m.schema_version,
        'metadata', m.metadata,
        'embedding', jsonb_strip_nulls(jsonb_build_object(
          'engine', m.embedding_engine,
          'dimensions', m.embedding_dims,
          'embeddedAt', m.embedded_at
        )),
        'evidence', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'sourceEventId', me.source_event_id,
            'span', me.evidence_span
          ) ORDER BY me.source_event_id)
          FROM public.memory_evidence me WHERE me.memory_id = m.id
        ), '[]'::jsonb),
        'decision', (
          SELECT jsonb_build_object(
            'rationale', d.rationale,
            'alternatives', d.alternatives,
            'decisionMaker', d.decision_maker,
            'effectiveAt', d.effective_at
          )
          FROM public.decisions d WHERE d.memory_id = m.id
        ),
        'task', (
          SELECT jsonb_build_object(
            'ownerSubjectId', t.owner_subject_id,
            'status', t.task_status,
            'priority', t.priority,
            'dueAt', t.due_at,
            'dependencies', t.dependencies
          )
          FROM public.tasks t WHERE t.memory_id = m.id
        )
      )) ORDER BY m.recorded_at DESC)
      FROM (
        SELECT * FROM public.memory_records candidate
        WHERE candidate.workspace_id = p_workspace_id
          AND app.effective_memory_project_id(candidate.id) = p_project_id
        ORDER BY candidate.recorded_at DESC, candidate.id DESC
        LIMIT v_limit OFFSET v_offset
      ) m
    ), '[]'::jsonb),
    'sourceEvents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'provider', s.provider,
        'eventType', s.event_type,
        'connectorAccountId', s.connector_account_id,
        'idempotencyKey', s.idempotency_key,
        'observedAt', s.observed_at,
        'recordedAt', s.recorded_at,
        'schemaVersion', s.schema_version,
        'sensitivity', s.sensitivity,
        'storageMode', s.storage_mode,
        'payload', s.payload,
        'contentChecksum', s.content_checksum,
        'createdBySubject', s.created_by_subject
      ) ORDER BY s.recorded_at DESC)
      FROM (
        SELECT * FROM public.source_events source
        WHERE source.workspace_id = p_workspace_id
          AND source.project_id = p_project_id
        ORDER BY source.recorded_at DESC, source.id DESC
        LIMIT v_limit OFFSET v_offset
      ) s
    ), '[]'::jsonb),
    'artifacts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'sourceEventId', a.source_event_id,
        'mimeType', a.mime_type,
        'storageMode', a.storage_mode,
        'storageKey', a.storage_key,
        'checksumSha256', a.checksum_sha256,
        'byteSize', a.byte_size,
        'versionLabel', a.version_label,
        'metadata', a.metadata,
        'createdAt', a.created_at,
        'chunks', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'index', c.chunk_index,
            'content', c.content,
            'charStart', c.char_start,
            'charEnd', c.char_end,
            'metadata', c.metadata
          ) ORDER BY c.chunk_index)
          FROM public.artifact_chunks c WHERE c.artifact_id = a.id
        ), '[]'::jsonb)
      ) ORDER BY a.created_at DESC)
      FROM (
        SELECT * FROM public.artifacts artifact
        WHERE artifact.workspace_id = p_workspace_id
          AND artifact.project_id = p_project_id
        ORDER BY artifact.created_at DESC, artifact.id DESC
        LIMIT v_limit OFFSET v_offset
      ) a
    ), '[]'::jsonb),
    'connectorAccounts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'connectorId', c.connector_id,
        'displayName', c.display_name,
        'status', c.status,
        'scopes', c.scopes,
        'lastSyncAt', c.last_sync_at,
        'createdAt', c.created_at,
        'updatedAt', c.updated_at
      ) ORDER BY c.created_at)
      FROM (
        SELECT * FROM public.connector_accounts candidate
        WHERE candidate.workspace_id = p_workspace_id
          AND EXISTS (
            SELECT 1 FROM public.source_events s
            WHERE s.connector_account_id = candidate.id
              AND s.project_id = p_project_id
          )
        ORDER BY candidate.created_at, candidate.id
        LIMIT v_limit OFFSET v_offset
      ) c
    ), '[]'::jsonb),
    'privacyRequests', coalesce((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', r.id,
        'requestType', r.request_type,
        'status', r.status,
        'targetMemoryId', r.target_memory_id,
        'targetConnectorAccountId', r.target_connector_account_id,
        'reason', r.reason,
        'correctionText', r.correction_text,
        'createdAt', r.created_at,
        'completedAt', r.completed_at,
        'resultSummary', r.result_summary
      )) ORDER BY r.created_at DESC)
      FROM (
        SELECT * FROM public.privacy_requests candidate
        WHERE candidate.workspace_id = p_workspace_id
          AND candidate.project_id = p_project_id
        ORDER BY candidate.created_at DESC, candidate.id DESC
        LIMIT v_limit OFFSET v_offset
      ) r
    ), '[]'::jsonb)
  ) INTO v_bundle;

  INSERT INTO public.audit_log (
    workspace_id, actor_subject_id, action, object_type, reason, after_state
  ) VALUES (
    p_workspace_id, p_subject_id, 'privacy.export.completed',
    'privacy_export', 'privacy export completed',
    jsonb_build_object(
      'projectId', p_project_id,
      'memoryCount', v_memory_count,
      'sourceEventCount', v_source_count,
      'artifactCount', v_artifact_count,
      'connectorAccountCount', v_connector_count,
      'privacyRequestCount', v_request_count,
      'limit', v_limit,
      'offset', v_offset
    )
  );

  RETURN v_bundle;
END;
$$;

CREATE OR REPLACE FUNCTION public.api_export_project_privacy_bundle(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_export_project_privacy_bundle(
    p_secret, p_subject_id, p_workspace_id, p_project_id, p_limit, p_offset
  );
$$;

CREATE OR REPLACE FUNCTION app.api_execute_privacy_request(
  p_secret text,
  p_subject_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, vault, extensions
AS $$
DECLARE
  v_request public.privacy_requests%ROWTYPE;
  v_result jsonb := '{}'::jsonb;
  v_authoritative_memory_id uuid;
  v_affected_ids uuid[] := '{}'::uuid[];
  v_source_ids uuid[] := '{}'::uuid[];
  v_entity_ids uuid[] := '{}'::uuid[];
  v_artifact_ids uuid[] := '{}'::uuid[];
  v_vault_ref text;
  v_affected_count integer := 0;
  v_source_count integer := 0;
  v_artifact_count integer := 0;
  v_graph_count integer := 0;
  v_vault_count integer := 0;
  v_stopped_job_count integer := 0;
  v_previous_affected_count integer := -1;
  v_previous_source_count integer := -1;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT * INTO v_request
  FROM public.privacy_requests r
  WHERE r.id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'privacy request not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    WHERE wm.workspace_id = v_request.workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_request.status = 'completed' THEN
    RETURN jsonb_build_object(
      'id', v_request.id,
      'status', v_request.status,
      'completedAt', v_request.completed_at,
      'resultSummary', v_request.result_summary,
      'idempotent', true
    );
  END IF;
  IF v_request.status NOT IN ('submitted', 'processing') THEN
    RAISE EXCEPTION 'privacy request is not executable: %', v_request.status;
  END IF;
  IF v_request.request_type NOT IN ('deletion', 'correction', 'retraction') THEN
    RAISE EXCEPTION 'invalid privacy request type: %', v_request.request_type;
  END IF;
  IF v_request.request_type IN ('correction', 'retraction')
     AND v_request.target_memory_id IS NULL THEN
    RAISE EXCEPTION 'target_memory_id required for %', v_request.request_type;
  END IF;
  IF v_request.request_type = 'correction'
     AND nullif(btrim(coalesce(v_request.correction_text, '')), '') IS NULL THEN
    RAISE EXCEPTION 'correction_text required for correction';
  END IF;
  IF v_request.request_type = 'deletion'
     AND v_request.target_memory_id IS NULL
     AND v_request.target_connector_account_id IS NULL THEN
    RAISE EXCEPTION 'deletion requires a memory or connector target';
  END IF;
  IF v_request.target_memory_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.memory_records m
    WHERE m.id = v_request.target_memory_id
      AND m.workspace_id = v_request.workspace_id
      AND app.effective_memory_project_id(m.id) = v_request.project_id
  ) THEN
    RAISE EXCEPTION 'memory target not found in project' USING ERRCODE = 'P0002';
  END IF;
  IF v_request.target_connector_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.connector_accounts c
    WHERE c.id = v_request.target_connector_account_id
      AND c.workspace_id = v_request.workspace_id
  ) THEN
    RAISE EXCEPTION 'connector target not found in workspace' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.privacy_requests
  SET status = 'processing', failure_code = NULL
  WHERE id = v_request.id;

  IF v_request.request_type = 'correction' THEN
    v_result := app.api_correct_memory(
      p_secret, p_subject_id, v_request.target_memory_id,
      format('privacy request %s', v_request.id),
      NULL, v_request.correction_text, NULL
    );
    v_authoritative_memory_id := nullif(v_result->>'authoritativeId', '')::uuid;

    -- api_correct_memory predates privacy operations and stores a complete
    -- before-state snapshot. Keep the audit envelope, but replace sensitive
    -- body/title/reason material with identifiers before completing the request.
    UPDATE public.audit_log a
    SET reason = 'privacy correction redacted',
        before_state = NULL,
        after_state = jsonb_build_object(
          'privacyRequestId', v_request.id,
          'supersededMemoryId', v_request.target_memory_id,
          'authoritativeMemoryId', v_authoritative_memory_id
        )
    WHERE a.workspace_id = v_request.workspace_id
      AND a.action = 'memory.correct'
      AND a.object_id = v_request.target_memory_id
      AND a.after_state->>'authoritativeId' = v_authoritative_memory_id::text;

    v_result := jsonb_build_object(
      'operation', 'correction',
      'targetMemoryId', v_request.target_memory_id,
      'authoritativeMemoryId', v_authoritative_memory_id
    );
  ELSIF v_request.request_type = 'retraction' THEN
    v_result := app.api_set_memory_status(
      p_secret, p_subject_id, v_request.target_memory_id, 'retracted',
      format('privacy request %s', v_request.id)
    );
    v_result := jsonb_build_object(
      'operation', 'retraction',
      'targetMemoryId', v_request.target_memory_id,
      'status', 'retracted'
    );
  ELSE
    -- Revoke a targeted connector before sanitizing its source-derived data.
    IF v_request.target_connector_account_id IS NOT NULL THEN
      FOR v_vault_ref IN
        SELECT DISTINCT cs.vault_ref
        FROM public.connector_secrets cs
        WHERE cs.connector_account_id = v_request.target_connector_account_id
      LOOP
        PERFORM app.api_vault_delete(p_secret, v_vault_ref);
        PERFORM app.api_vault_kms_delete(p_secret, v_vault_ref);
        v_vault_count := v_vault_count + 1;
      END LOOP;

      DELETE FROM public.connector_secrets
      WHERE connector_account_id = v_request.target_connector_account_id;
      DELETE FROM public.connector_cursors
      WHERE account_id = v_request.target_connector_account_id;

      WITH stopped AS (
        UPDATE public.processing_jobs j
        SET status = 'dead_letter',
            error = 'connector revoked by privacy request',
            attempt = j.attempt + 1,
            updated_at = now()
        WHERE j.workspace_id = v_request.workspace_id
          AND j.status IN ('queued', 'running')
          AND j.id IN (
            SELECT (o.payload->>'jobId')::uuid
            FROM public.outbox_events o
            WHERE o.workspace_id = v_request.workspace_id
              AND o.payload->>'connectionId' = v_request.target_connector_account_id::text
              AND coalesce(o.payload->>'jobId', '') ~* '^[0-9a-f-]{36}$'
          )
        RETURNING j.id
      ) SELECT count(*) INTO v_stopped_job_count FROM stopped;

      UPDATE public.outbox_events o
      SET published_at = coalesce(o.published_at, now()),
          attempts = o.attempts + 1,
          last_error = 'connector revoked by privacy request'
      WHERE o.workspace_id = v_request.workspace_id
        AND o.published_at IS NULL
        AND o.payload->>'connectionId' = v_request.target_connector_account_id::text;

      UPDATE public.connector_accounts c
      SET status = 'revoked',
          last_error = NULL,
          metadata = jsonb_build_object(
            'privacyRevoked', true,
            'privacyRequestId', v_request.id,
            'revokedAt', now()
          ),
          updated_at = now()
      WHERE c.id = v_request.target_connector_account_id
        AND c.workspace_id = v_request.workspace_id;
    END IF;

    SELECT coalesce(array_agg(DISTINCT source_id), '{}'::uuid[])
    INTO v_source_ids
    FROM (
      SELECT m.source_event_id AS source_id
      FROM public.memory_records m
      WHERE m.id = v_request.target_memory_id
      UNION
      SELECT me.source_event_id
      FROM public.memory_evidence me
      WHERE me.memory_id = v_request.target_memory_id
      UNION
      SELECT s.id
      FROM public.source_events s
      WHERE v_request.target_connector_account_id IS NOT NULL
        AND s.workspace_id = v_request.workspace_id
        AND s.connector_account_id = v_request.target_connector_account_id
    ) sources WHERE source_id IS NOT NULL;

    SELECT coalesce(array_agg(DISTINCT memory_id), '{}'::uuid[])
    INTO v_affected_ids
    FROM (
      SELECT v_request.target_memory_id AS memory_id
      WHERE v_request.target_memory_id IS NOT NULL
      UNION
      SELECT m.id FROM public.memory_records m
      WHERE m.workspace_id = v_request.workspace_id
        AND (
          v_request.target_connector_account_id IS NOT NULL
          OR app.effective_memory_project_id(m.id) = v_request.project_id
        )
        AND m.source_event_id = ANY(v_source_ids)
      UNION
      SELECT me.memory_id FROM public.memory_evidence me
      JOIN public.memory_records m ON m.id = me.memory_id
      WHERE me.source_event_id = ANY(v_source_ids)
        AND m.workspace_id = v_request.workspace_id
        AND (
          v_request.target_connector_account_id IS NOT NULL
          OR app.effective_memory_project_id(m.id) = v_request.project_id
        )
    ) affected WHERE memory_id IS NOT NULL;

    -- Walk metadata derivations and newly discovered provenance to a fixed
    -- point. A single pass misses chains such as A -> B -> C.
    LOOP
      v_previous_affected_count := cardinality(v_affected_ids);
      v_previous_source_count := cardinality(v_source_ids);

      SELECT coalesce(array_agg(DISTINCT memory_id), '{}'::uuid[])
      INTO v_affected_ids
      FROM (
        SELECT unnest(v_affected_ids) AS memory_id
        UNION
        SELECT m.id FROM public.memory_records m
        WHERE m.workspace_id = v_request.workspace_id
          AND (
            v_request.target_connector_account_id IS NOT NULL
            OR app.effective_memory_project_id(m.id) = v_request.project_id
          )
          AND EXISTS (
            SELECT 1 FROM unnest(v_affected_ids) affected(id)
            WHERE m.metadata::text LIKE '%' || affected.id::text || '%'
          )
      ) expanded;

      SELECT coalesce(array_agg(DISTINCT source_id), '{}'::uuid[])
      INTO v_source_ids
      FROM (
        SELECT unnest(v_source_ids) AS source_id
        UNION
        SELECT m.source_event_id FROM public.memory_records m
        WHERE m.id = ANY(v_affected_ids) AND m.source_event_id IS NOT NULL
        UNION
        SELECT me.source_event_id FROM public.memory_evidence me
        WHERE me.memory_id = ANY(v_affected_ids)
      ) expanded_sources;

      SELECT coalesce(array_agg(DISTINCT memory_id), '{}'::uuid[])
      INTO v_affected_ids
      FROM (
        SELECT unnest(v_affected_ids) AS memory_id
        UNION
        SELECT m.id FROM public.memory_records m
        WHERE m.workspace_id = v_request.workspace_id
          AND (
            v_request.target_connector_account_id IS NOT NULL
            OR app.effective_memory_project_id(m.id) = v_request.project_id
          )
          AND m.source_event_id = ANY(v_source_ids)
        UNION
        SELECT me.memory_id FROM public.memory_evidence me
        JOIN public.memory_records m ON m.id = me.memory_id
        WHERE me.source_event_id = ANY(v_source_ids)
          AND m.workspace_id = v_request.workspace_id
          AND (
            v_request.target_connector_account_id IS NOT NULL
            OR app.effective_memory_project_id(m.id) = v_request.project_id
          )
      ) provenance_expanded;

      EXIT WHEN v_previous_affected_count = cardinality(v_affected_ids)
        AND v_previous_source_count = cardinality(v_source_ids);
    END LOOP;

    SELECT coalesce(array_agg(DISTINCT entity_id), '{}'::uuid[])
    INTO v_entity_ids
    FROM (
      SELECT me.entity_id FROM public.memory_entities me
      WHERE me.memory_id = ANY(v_affected_ids)
      UNION
      SELECT e.id FROM public.entities e
      WHERE e.created_from_memory_id = ANY(v_affected_ids)
         OR e.source_event_id = ANY(v_source_ids)
    ) graph_entities;

    DELETE FROM public.entity_edges e
    WHERE e.memory_id = ANY(v_affected_ids)
       OR e.source_event_id = ANY(v_source_ids);
    GET DIAGNOSTICS v_graph_count = ROW_COUNT;
    DELETE FROM public.entity_aliases a
    WHERE a.memory_id = ANY(v_affected_ids)
       OR a.source_event_id = ANY(v_source_ids);
    DELETE FROM public.memory_entities me
    WHERE me.memory_id = ANY(v_affected_ids);
    UPDATE public.entities e
    SET canonical_name = 'Redacted shared entity',
        status = 'archived',
        confidence = 0,
        source_event_id = NULL,
        created_from_memory_id = NULL,
        source_ref = 'privacy-redacted:' || e.id::text,
        metadata = jsonb_build_object(
          'privacySourceRemoved', true,
          'privacyRequestId', v_request.id
        ),
        updated_at = now()
    WHERE e.id = ANY(v_entity_ids)
      AND (
        e.source_event_id = ANY(v_source_ids)
        OR e.created_from_memory_id = ANY(v_affected_ids)
      )
      AND EXISTS (
        SELECT 1 FROM public.memory_entities me WHERE me.entity_id = e.id
      );
    DELETE FROM public.entities e
    WHERE e.id = ANY(v_entity_ids)
      AND NOT EXISTS (SELECT 1 FROM public.memory_entities me WHERE me.entity_id = e.id);

    DELETE FROM public.memory_conflicts mc
    WHERE mc.left_memory_id = ANY(v_affected_ids)
       OR mc.right_memory_id = ANY(v_affected_ids);
    DELETE FROM public.memory_personalizations mp
    WHERE mp.memory_id = ANY(v_affected_ids);
    UPDATE public.project_routing_corrections prc
    SET reason = 'privacy request deletion',
        source_evidence = jsonb_build_object(
          'privacyDeleted', true,
          'privacyRequestId', v_request.id
        )
    WHERE prc.memory_id = ANY(v_affected_ids);
    UPDATE public.approval_checkpoints ac
    SET approved_memory_id = NULL,
        approved_source_event_id = NULL,
        requested_reason = 'privacy request deletion',
        decision_reason = CASE
          WHEN ac.decision_reason IS NULL THEN NULL
          ELSE 'privacy request deletion'
        END,
        payload = jsonb_build_object(
          'privacyDeleted', true,
          'privacyRequestId', v_request.id
        ),
        updated_at = now()
    WHERE ac.approved_memory_id = ANY(v_affected_ids)
       OR ac.approved_source_event_id = ANY(v_source_ids);
    UPDATE public.handoffs h
    SET payload = jsonb_build_object(
      'privacyDeleted', true,
      'privacyRequestId', v_request.id
    )
    WHERE h.memory_id = ANY(v_affected_ids);
    DELETE FROM public.tasks t WHERE t.memory_id = ANY(v_affected_ids);
    DELETE FROM public.decisions d WHERE d.memory_id = ANY(v_affected_ids);
    DELETE FROM public.memory_revisions mr WHERE mr.memory_id = ANY(v_affected_ids);
    DELETE FROM public.memory_evidence me WHERE me.memory_id = ANY(v_affected_ids);

    UPDATE public.memory_records m
    SET title = 'Deleted memory',
        content = '[deleted by privacy request]',
        status = 'deleted',
        valid_to = coalesce(m.valid_to, now()),
        embedding = NULL,
        embedding_vector = NULL,
        embedding_vector_hq = NULL,
        embedding_engine = NULL,
        embedding_dims = NULL,
        embedded_at = NULL,
        metadata = jsonb_build_object(
          'privacyDeleted', true,
          'privacyRequestId', v_request.id,
          'deletedAt', now()
        )
    WHERE m.id = ANY(v_affected_ids);
    GET DIAGNOSTICS v_affected_count = ROW_COUNT;

    SELECT coalesce(array_agg(a.id), '{}'::uuid[]) INTO v_artifact_ids
    FROM public.artifacts a WHERE a.source_event_id = ANY(v_source_ids);
    DELETE FROM public.artifact_chunks c WHERE c.artifact_id = ANY(v_artifact_ids);
    UPDATE public.artifacts a
    SET storage_key = NULL,
        checksum_sha256 = NULL,
        byte_size = NULL,
        storage_mode = 'reference',
        metadata = jsonb_build_object(
          'privacyDeleted', true,
          'privacyRequestId', v_request.id,
          'deletedAt', now()
        )
    WHERE a.id = ANY(v_artifact_ids);
    GET DIAGNOSTICS v_artifact_count = ROW_COUNT;

    UPDATE public.source_events s
    SET idempotency_key = 'privacy-deleted/' || s.id::text,
        payload = jsonb_build_object(
          'schema_version', s.schema_version,
          'tombstone', true,
          'privacy_deleted', true,
          'privacy_request_id', v_request.id
        ),
        content_checksum = NULL,
        trace_id = NULL,
        storage_mode = 'reference'
    WHERE s.id = ANY(v_source_ids);
    GET DIAGNOSTICS v_source_count = ROW_COUNT;

    v_result := jsonb_build_object(
      'operation', 'deletion',
      'targetMemoryId', v_request.target_memory_id,
      'targetConnectorAccountId', v_request.target_connector_account_id,
      'affectedMemoryCount', v_affected_count,
      'sourceEventCount', v_source_count,
      'artifactCount', v_artifact_count,
      'graphProjectionCount', v_graph_count,
      'vaultReferenceCount', v_vault_count,
      'stoppedJobCount', v_stopped_job_count,
      'sourceRevoked', v_request.target_connector_account_id IS NOT NULL
    );

    -- Historic audit rows can contain snapshots from pre-M20 operations.
    -- Retain the event envelope while removing bodies tied to erased objects.
    UPDATE public.audit_log a
    SET reason = 'privacy deletion redacted',
        before_state = NULL,
        after_state = jsonb_build_object(
          'privacyDeleted', true,
          'privacyRequestId', v_request.id
        )
    WHERE a.workspace_id = v_request.workspace_id
      AND (
        a.object_id = ANY(v_affected_ids)
        OR a.object_id = ANY(v_source_ids)
        OR EXISTS (
          SELECT 1 FROM unnest(v_affected_ids || v_source_ids) erased(id)
          WHERE coalesce(a.before_state, '{}'::jsonb)::text LIKE '%' || erased.id::text || '%'
             OR coalesce(a.after_state, '{}'::jsonb)::text LIKE '%' || erased.id::text || '%'
        )
      );
  END IF;

  UPDATE public.privacy_requests
  SET status = 'completed', completed_at = now(), result_summary = v_result,
      failure_code = NULL, reason = '[redacted after execution]',
      correction_text = NULL
  WHERE id = v_request.id;

  INSERT INTO public.audit_log (
    workspace_id, actor_subject_id, action, object_type, object_id, reason,
    after_state
  ) VALUES (
    v_request.workspace_id, p_subject_id, 'privacy.request.completed',
    'privacy_request', v_request.id, 'privacy request completed',
    v_result
  );

  RETURN jsonb_build_object(
    'id', v_request.id,
    'status', 'completed',
    'completedAt', now(),
    'resultSummary', v_result,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_execute_privacy_request(
  p_secret text,
  p_subject_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, vault, extensions
AS $$
  SELECT app.api_execute_privacy_request(p_secret, p_subject_id, p_request_id);
$$;

CREATE OR REPLACE FUNCTION app.api_apply_retention_policy(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_as_of timestamptz DEFAULT now(),
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_candidate_ids uuid[] := '{}'::uuid[];
  v_entity_ids uuid[] := '{}'::uuid[];
  v_artifact_ids uuid[] := '{}'::uuid[];
  v_artifact_source_ids uuid[] := '{}'::uuid[];
  v_candidate_count integer := 0;
  v_artifact_count integer := 0;
  v_outbox_count integer := 0;
  v_dead_letter_count integer := 0;
  v_audit_count integer := 0;
  v_result jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL THEN RAISE EXCEPTION 'project_id required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'project not found in workspace' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(array_agg(m.id), '{}'::uuid[]) INTO v_candidate_ids
  FROM public.memory_records m
  WHERE m.workspace_id = p_workspace_id
    AND app.effective_memory_project_id(m.id) = p_project_id
    AND m.status = 'candidate'
    AND m.recorded_at < p_as_of - interval '90 days';
  v_candidate_count := cardinality(v_candidate_ids);

  SELECT coalesce(array_agg(a.id), '{}'::uuid[]) INTO v_artifact_ids
  FROM public.artifacts a
  WHERE a.workspace_id = p_workspace_id
    AND a.project_id = p_project_id
    AND a.created_at < p_as_of - interval '180 days';
  v_artifact_count := cardinality(v_artifact_ids);
  SELECT coalesce(array_agg(DISTINCT a.source_event_id), '{}'::uuid[])
  INTO v_artifact_source_ids
  FROM public.artifacts a
  WHERE a.id = ANY(v_artifact_ids) AND a.source_event_id IS NOT NULL;

  SELECT count(*) INTO v_outbox_count FROM public.outbox_events o
  WHERE o.workspace_id = p_workspace_id
    AND o.published_at IS NOT NULL
    AND o.published_at < p_as_of - interval '30 days';
  SELECT count(*) INTO v_dead_letter_count FROM public.processing_jobs j
  WHERE j.workspace_id = p_workspace_id
    AND j.status = 'dead_letter'
    AND j.updated_at < p_as_of - interval '90 days';
  SELECT count(*) INTO v_audit_count FROM public.audit_log a
  WHERE a.workspace_id = p_workspace_id
    AND a.recorded_at < p_as_of - interval '365 days';

  v_result := jsonb_build_object(
    'policyVersion', 'm20-s04-v1',
    'asOf', p_as_of,
    'dryRun', p_dry_run,
    'projectId', p_project_id,
    'candidateMemories', v_candidate_count,
    'quarantineArtifacts', v_artifact_count,
    'publishedOutboxEvents', v_outbox_count,
    'deadLetterJobs', v_dead_letter_count,
    'auditEvents', v_audit_count
  );

  IF NOT p_dry_run THEN
    SELECT coalesce(array_agg(DISTINCT entity_id), '{}'::uuid[])
    INTO v_entity_ids
    FROM (
      SELECT me.entity_id FROM public.memory_entities me
      WHERE me.memory_id = ANY(v_candidate_ids)
      UNION
      SELECT e.id FROM public.entities e
      WHERE e.created_from_memory_id = ANY(v_candidate_ids)
    ) retention_entities;

    -- Remove typed and graph projections before tombstoning the source memory.
    -- Entity ids must be collected first so graph rows cannot become orphans.
    DELETE FROM public.memory_conflicts mc
    WHERE mc.left_memory_id = ANY(v_candidate_ids)
       OR mc.right_memory_id = ANY(v_candidate_ids);
    DELETE FROM public.memory_personalizations mp
    WHERE mp.memory_id = ANY(v_candidate_ids);
    DELETE FROM public.tasks t WHERE t.memory_id = ANY(v_candidate_ids);
    DELETE FROM public.decisions d WHERE d.memory_id = ANY(v_candidate_ids);
    DELETE FROM public.memory_revisions mr WHERE mr.memory_id = ANY(v_candidate_ids);
    DELETE FROM public.memory_evidence me WHERE me.memory_id = ANY(v_candidate_ids);
    DELETE FROM public.entity_edges e
    WHERE e.memory_id = ANY(v_candidate_ids);
    DELETE FROM public.entity_aliases a
    WHERE a.memory_id = ANY(v_candidate_ids);
    DELETE FROM public.memory_entities me
    WHERE me.memory_id = ANY(v_candidate_ids);
    DELETE FROM public.entities e
    WHERE e.id = ANY(v_entity_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.memory_entities me WHERE me.entity_id = e.id
      );
    UPDATE public.project_routing_corrections prc
    SET reason = 'retention policy expiry',
        source_evidence = jsonb_build_object(
          'retentionExpired', true,
          'policyVersion', 'm20-s04-v1'
        )
    WHERE prc.memory_id = ANY(v_candidate_ids);
    UPDATE public.approval_checkpoints ac
    SET approved_memory_id = NULL,
        requested_reason = 'retention policy expiry',
        decision_reason = CASE
          WHEN ac.decision_reason IS NULL THEN NULL
          ELSE 'retention policy expiry'
        END,
        payload = jsonb_build_object(
          'retentionExpired', true,
          'policyVersion', 'm20-s04-v1'
        ),
        updated_at = now()
    WHERE ac.approved_memory_id = ANY(v_candidate_ids);
    UPDATE public.handoffs h
    SET payload = jsonb_build_object(
      'retentionExpired', true,
      'policyVersion', 'm20-s04-v1'
    )
    WHERE h.memory_id = ANY(v_candidate_ids);
    UPDATE public.audit_log a
    SET reason = 'retention expiry redacted',
        before_state = NULL,
        after_state = jsonb_build_object(
          'retentionExpired', true,
          'policyVersion', 'm20-s04-v1'
        )
    WHERE a.workspace_id = p_workspace_id
      AND (
        a.object_id = ANY(v_candidate_ids)
        OR EXISTS (
          SELECT 1 FROM unnest(v_candidate_ids) expired(id)
          WHERE coalesce(a.before_state, '{}'::jsonb)::text LIKE '%' || expired.id::text || '%'
             OR coalesce(a.after_state, '{}'::jsonb)::text LIKE '%' || expired.id::text || '%'
        )
      );
    UPDATE public.memory_records m
    SET title = 'Expired candidate memory',
        content = '[expired by retention policy]',
        status = 'deleted',
        valid_to = coalesce(m.valid_to, p_as_of),
        embedding = NULL,
        embedding_vector = NULL,
        embedding_vector_hq = NULL,
        embedding_engine = NULL,
        embedding_dims = NULL,
        embedded_at = NULL,
        metadata = jsonb_build_object(
          'retentionExpired', true,
          'policyVersion', 'm20-s04-v1',
          'expiredAt', p_as_of
        )
    WHERE m.id = ANY(v_candidate_ids);

    DELETE FROM public.artifact_chunks c WHERE c.artifact_id = ANY(v_artifact_ids);
    UPDATE public.artifacts a
    SET storage_key = NULL, checksum_sha256 = NULL, byte_size = NULL,
        storage_mode = 'reference',
        metadata = jsonb_build_object(
          'retentionExpired', true,
          'policyVersion', 'm20-s04-v1',
          'expiredAt', p_as_of
        )
    WHERE a.id = ANY(v_artifact_ids);
    UPDATE public.source_events s
    SET payload = jsonb_build_object(
          'schema_version', s.schema_version,
          'tombstone', true,
          'retention_expired', true,
          'policy_version', 'm20-s04-v1'
        ),
        content_checksum = NULL,
        trace_id = NULL,
        storage_mode = 'reference'
    WHERE s.id = ANY(v_artifact_source_ids);
    DELETE FROM public.outbox_events o
    WHERE o.workspace_id = p_workspace_id
      AND o.published_at IS NOT NULL
      AND o.published_at < p_as_of - interval '30 days';
    DELETE FROM public.processing_jobs j
    WHERE j.workspace_id = p_workspace_id
      AND j.status = 'dead_letter'
      AND j.updated_at < p_as_of - interval '90 days';
    DELETE FROM public.audit_log a
    WHERE a.workspace_id = p_workspace_id
      AND a.recorded_at < p_as_of - interval '365 days';

    INSERT INTO public.audit_log (
      workspace_id, actor_subject_id, action, object_type, reason, after_state
    ) VALUES (
      p_workspace_id, p_subject_id, 'privacy.retention.applied',
      'retention_policy', 'retention policy applied', v_result
    );
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.api_apply_retention_policy(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_as_of timestamptz DEFAULT now(),
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_apply_retention_policy(
    p_secret, p_subject_id, p_workspace_id, p_project_id, p_as_of, p_dry_run
  );
$$;

REVOKE ALL ON FUNCTION app.api_create_privacy_request_v2(
  text, uuid, uuid, uuid, text, uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_create_privacy_request_v2(
  text, uuid, uuid, uuid, text, uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.api_export_project_privacy_bundle(
  text, uuid, uuid, uuid, integer, integer
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_export_project_privacy_bundle(
  text, uuid, uuid, uuid, integer, integer
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.api_execute_privacy_request(text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_execute_privacy_request(text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.api_apply_retention_policy(
  text, uuid, uuid, uuid, timestamptz, boolean
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_apply_retention_policy(
  text, uuid, uuid, uuid, timestamptz, boolean
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION app.api_create_privacy_request_v2(
  text, uuid, uuid, uuid, text, uuid, uuid, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_create_privacy_request_v2(
  text, uuid, uuid, uuid, text, uuid, uuid, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION app.api_export_project_privacy_bundle(
  text, uuid, uuid, uuid, integer, integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_export_project_privacy_bundle(
  text, uuid, uuid, uuid, integer, integer
) TO service_role;
GRANT EXECUTE ON FUNCTION app.api_execute_privacy_request(text, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.api_execute_privacy_request(text, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION app.api_apply_retention_policy(
  text, uuid, uuid, uuid, timestamptz, boolean
) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_apply_retention_policy(
  text, uuid, uuid, uuid, timestamptz, boolean
) TO service_role;
