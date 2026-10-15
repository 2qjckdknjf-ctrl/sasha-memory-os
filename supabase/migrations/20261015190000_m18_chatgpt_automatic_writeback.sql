-- M18.4: approved-only ChatGPT automatic writeback over the existing
-- memory.store_decision surface. The policy is enforced atomically in Postgres.

CREATE OR REPLACE FUNCTION app.api_chatgpt_writeback_decision(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_title text,
  p_content text,
  p_idempotency_key text,
  p_writeback jsonb,
  p_importance numeric DEFAULT 0.8,
  p_confidence numeric DEFAULT 0.9,
  p_sensitivity text DEFAULT 'internal',
  p_rationale text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_chatgpt_subject constant uuid := '33333333-3333-4333-8333-333333333302';
  v_pack_version constant text := 'm18-s04-v1';
  v_kind text;
  v_approval_source text;
  v_approval_reference text;
  v_evidence_refs jsonb;
  v_evidence_ref text;
  v_normalized_title text;
  v_normalized_content text;
  v_fingerprint text;
  v_provenance jsonb;
  v_existing_id uuid;
  v_conflict_id uuid;
  v_event_id uuid;
  v_memory_id uuid;
  v_readback jsonb;
  v_event_payload jsonb;
  v_audit jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);

  IF p_subject_id IS DISTINCT FROM v_chatgpt_subject THEN
    RAISE EXCEPTION 'automatic writeback requires the canonical ChatGPT subject'
      USING ERRCODE = '42501';
  END IF;
  PERFORM app.with_subject(p_subject_id);

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id is required for automatic writeback'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM projects p
    WHERE p.id = p_project_id
      AND p.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'project not found in workspace' USING ERRCODE = 'P0002';
  END IF;
  IF p_sensitivity IS DISTINCT FROM 'internal' THEN
    RAISE EXCEPTION 'automatic writeback sensitivity must be internal'
      USING ERRCODE = '22023';
  END IF;
  IF NOT app.has_acl(
    p_workspace_id,
    'memory',
    'write',
    p_project_id,
    p_sensitivity
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_writeback IS NULL OR jsonb_typeof(p_writeback) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'writeback policy envelope is required'
      USING ERRCODE = '22023';
  END IF;
  v_kind := NULLIF(btrim(p_writeback->>'kind'), '');
  v_approval_source := NULLIF(btrim(p_writeback#>>'{approval,source}'), '');
  v_approval_reference := NULLIF(btrim(p_writeback#>>'{approval,reference}'), '');
  v_evidence_refs := p_writeback->'evidence_refs';

  IF v_kind IS NULL
     OR v_kind NOT IN ('approved_decision', 'completed_milestone') THEN
    RAISE EXCEPTION 'unsupported automatic writeback kind'
      USING ERRCODE = '22023';
  END IF;
  IF v_approval_source IS NULL
     OR v_approval_source NOT IN ('explicit_user', 'verified_workflow') THEN
    RAISE EXCEPTION 'approved writeback provenance is required'
      USING ERRCODE = '22023';
  END IF;
  IF v_kind = 'approved_decision' AND v_approval_source <> 'explicit_user' THEN
    RAISE EXCEPTION 'approved decisions require explicit user approval'
      USING ERRCODE = '22023';
  END IF;
  IF v_approval_reference IS NULL OR length(v_approval_reference) > 500 THEN
    RAISE EXCEPTION 'bounded approval reference is required'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_evidence_refs) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_evidence_refs) NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'between 1 and 12 evidence_refs are required'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_evidence_refs) AS refs(value)
    WHERE jsonb_typeof(value) IS DISTINCT FROM 'string'
  ) THEN
    RAISE EXCEPTION 'evidence_refs must contain only strings'
      USING ERRCODE = '22023';
  END IF;
  FOR v_evidence_ref IN
    SELECT value FROM jsonb_array_elements_text(v_evidence_refs) AS refs(value)
  LOOP
    IF NULLIF(btrim(v_evidence_ref), '') IS NULL OR length(v_evidence_ref) > 500 THEN
      RAISE EXCEPTION 'evidence_refs must contain bounded non-empty strings'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF NULLIF(btrim(p_title), '') IS NULL OR length(p_title) > 240 THEN
    RAISE EXCEPTION 'title must contain 1 to 240 characters'
      USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_content), '') IS NULL OR length(p_content) > 20000 THEN
    RAISE EXCEPTION 'content must contain 1 to 20000 characters'
      USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_idempotency_key), '') IS NULL
     OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'idempotency_key must contain 1 to 200 characters'
      USING ERRCODE = '22023';
  END IF;

  v_normalized_title := regexp_replace(lower(btrim(p_title)), '\s+', ' ', 'g');
  v_normalized_content := regexp_replace(btrim(p_content), '\s+', ' ', 'g');
  v_fingerprint := encode(
    digest(
      convert_to(
        concat_ws(E'\n', v_kind, v_normalized_title, v_normalized_content),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_provenance := jsonb_build_object(
    'packVersion', v_pack_version,
    'kind', v_kind,
    'fingerprint', v_fingerprint,
    'approval', jsonb_build_object(
      'source', v_approval_source,
      'reference', v_approval_reference
    ),
    'evidenceRefs', v_evidence_refs,
    'actorSubjectId', p_subject_id,
    'projectId', p_project_id
  );

  -- Serialize the read-before-write decision for a project/title pair.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || p_project_id::text || ':' || v_normalized_title, 0)
  );

  SELECT m.id INTO v_existing_id
  FROM memory_records m
  WHERE m.workspace_id = p_workspace_id
    AND app.effective_memory_project_id(m.id) = p_project_id
    AND m.memory_type = 'decision'
    AND m.status IN ('active', 'verified')
    AND m.superseded_by IS NULL
    AND regexp_replace(lower(btrim(m.title)), '\s+', ' ', 'g') = v_normalized_title
    AND regexp_replace(btrim(m.content), '\s+', ' ', 'g') = v_normalized_content
    AND m.created_by_subject = p_subject_id
    AND m.metadata#>>'{chatgptWriteback,fingerprint}' = v_fingerprint
  ORDER BY m.recorded_at DESC, m.id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    v_readback := app.api_get_memory(p_secret, p_subject_id, v_existing_id);
    IF (v_readback->>'projectId')::uuid IS DISTINCT FROM p_project_id
       OR regexp_replace(lower(btrim(v_readback->>'title')), '\s+', ' ', 'g')
          IS DISTINCT FROM v_normalized_title
       OR regexp_replace(btrim(v_readback->>'content'), '\s+', ' ', 'g')
          IS DISTINCT FROM v_normalized_content
       OR v_readback->>'status' NOT IN ('active', 'verified')
       OR (v_readback->>'createdBySubject')::uuid IS DISTINCT FROM p_subject_id
       OR v_readback#>>'{metadata,chatgptWriteback,fingerprint}'
          IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'automatic writeback dedupe read-after-write verification failed';
    END IF;

    v_audit := app.api_append_audit_event(
      p_secret,
      p_subject_id,
      p_workspace_id,
      'chatgpt.writeback.deduplicated',
      'memory',
      v_existing_id,
      'exact approved writeback already exists',
      NULL,
      jsonb_build_object(
        'packVersion', v_pack_version,
        'projectId', p_project_id,
        'kind', v_kind,
        'fingerprint', v_fingerprint,
        'readBeforeWrite', true,
        'readAfterWrite', true
      )
    );
    RETURN jsonb_build_object(
      'memory', v_readback,
      'writeback', jsonb_build_object(
        'packVersion', v_pack_version,
        'outcome', 'deduplicated',
        'readBeforeWrite', true,
        'deduplicated', true,
        'readAfterWrite', true,
        'provenance', v_provenance,
        'audit', v_audit
      )
    );
  END IF;

  SELECT m.id INTO v_conflict_id
  FROM memory_records m
  WHERE m.workspace_id = p_workspace_id
    AND app.effective_memory_project_id(m.id) = p_project_id
    AND m.memory_type = 'decision'
    AND m.status IN ('active', 'verified')
    AND m.superseded_by IS NULL
    AND regexp_replace(lower(btrim(m.title)), '\s+', ' ', 'g') = v_normalized_title
  ORDER BY m.recorded_at DESC, m.id
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    v_audit := app.api_append_audit_event(
      p_secret,
      p_subject_id,
      p_workspace_id,
      'chatgpt.writeback.review_required',
      'memory',
      v_conflict_id,
      'same normalized title has different or unverified provenance',
      NULL,
      jsonb_build_object(
        'packVersion', v_pack_version,
        'projectId', p_project_id,
        'kind', v_kind,
        'fingerprint', v_fingerprint,
        'readBeforeWrite', true,
        'writePerformed', false
      )
    );
    RETURN jsonb_build_object(
      'memory', NULL,
      'writeback', jsonb_build_object(
        'packVersion', v_pack_version,
        'outcome', 'review_required',
        'readBeforeWrite', true,
        'deduplicated', false,
        'readAfterWrite', false,
        'writePerformed', false,
        'conflictMemoryId', v_conflict_id,
        'provenance', v_provenance,
        'audit', v_audit
      )
    );
  END IF;

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
    'chatgpt',
    'chatgpt.writeback.approved',
    p_idempotency_key,
    now(),
    p_sensitivity,
    'indexed',
    jsonb_build_object('title', p_title, 'chatgptWriteback', v_provenance),
    v_fingerprint,
    p_subject_id
  )
  ON CONFLICT (workspace_id, provider, idempotency_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT se.id, se.payload INTO v_event_id, v_event_payload
    FROM source_events se
    WHERE se.workspace_id = p_workspace_id
      AND se.provider = 'chatgpt'
      AND se.idempotency_key = p_idempotency_key;
    IF v_event_payload#>>'{chatgptWriteback,fingerprint}' IS DISTINCT FROM v_fingerprint
       OR (v_event_payload#>>'{chatgptWriteback,projectId}')::uuid IS DISTINCT FROM p_project_id THEN
      RAISE EXCEPTION 'idempotency key conflict for automatic writeback'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  SELECT m.id INTO v_memory_id
  FROM memory_records m
  WHERE m.source_event_id = v_event_id
    AND m.memory_type = 'decision'
  LIMIT 1;

  IF v_memory_id IS NULL THEN
    INSERT INTO memory_records (
      workspace_id,
      project_id,
      memory_type,
      title,
      content,
      status,
      importance,
      confidence,
      sensitivity,
      valid_from,
      observed_at,
      source_event_id,
      created_by_subject,
      metadata
    ) VALUES (
      p_workspace_id,
      p_project_id,
      'decision',
      p_title,
      p_content,
      'verified',
      p_importance,
      p_confidence,
      p_sensitivity,
      now(),
      now(),
      v_event_id,
      p_subject_id,
      jsonb_build_object('chatgptWriteback', v_provenance)
    )
    RETURNING id INTO v_memory_id;

    INSERT INTO decisions (
      memory_id,
      workspace_id,
      rationale,
      decision_maker,
      effective_at
    ) VALUES (
      v_memory_id,
      p_workspace_id,
      COALESCE(
        NULLIF(btrim(p_rationale), ''),
        format('Approved via %s (%s)', v_approval_source, v_approval_reference)
      ),
      p_subject_id::text,
      now()
    );
  END IF;

  v_readback := app.api_get_memory(p_secret, p_subject_id, v_memory_id);
  IF (v_readback->>'projectId')::uuid IS DISTINCT FROM p_project_id
     OR v_readback->>'title' IS DISTINCT FROM p_title
     OR v_readback->>'content' IS DISTINCT FROM p_content
     OR v_readback->>'status' IS DISTINCT FROM 'verified'
     OR (v_readback->>'createdBySubject')::uuid IS DISTINCT FROM p_subject_id
     OR v_readback#>>'{metadata,chatgptWriteback,fingerprint}' IS DISTINCT FROM v_fingerprint THEN
    RAISE EXCEPTION 'automatic writeback read-after-write verification failed';
  END IF;

  v_audit := app.api_append_audit_event(
    p_secret,
    p_subject_id,
    p_workspace_id,
    'chatgpt.writeback.created',
    'memory',
    v_memory_id,
    'approved automatic writeback created and verified',
    NULL,
    jsonb_build_object(
      'packVersion', v_pack_version,
      'projectId', p_project_id,
      'kind', v_kind,
      'fingerprint', v_fingerprint,
      'readBeforeWrite', true,
      'readAfterWrite', true
    )
  );

  RETURN jsonb_build_object(
    'memory', v_readback,
    'writeback', jsonb_build_object(
      'packVersion', v_pack_version,
      'outcome', 'created',
      'readBeforeWrite', true,
      'deduplicated', false,
      'readAfterWrite', true,
      'provenance', v_provenance,
      'audit', v_audit
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_chatgpt_writeback_decision(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_title text,
  p_content text,
  p_idempotency_key text,
  p_writeback jsonb,
  p_importance numeric DEFAULT 0.8,
  p_confidence numeric DEFAULT 0.9,
  p_sensitivity text DEFAULT 'internal',
  p_rationale text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_chatgpt_writeback_decision(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_project_id,
    p_title,
    p_content,
    p_idempotency_key,
    p_writeback,
    p_importance,
    p_confidence,
    p_sensitivity,
    p_rationale
  );
$$;

REVOKE ALL ON FUNCTION app.api_chatgpt_writeback_decision(
  text, uuid, uuid, uuid, text, text, text, jsonb, numeric, numeric, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_chatgpt_writeback_decision(
  text, uuid, uuid, uuid, text, text, text, jsonb, numeric, numeric, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION app.api_chatgpt_writeback_decision(
  text, uuid, uuid, uuid, text, text, text, jsonb, numeric, numeric, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_chatgpt_writeback_decision(
  text, uuid, uuid, uuid, text, text, text, jsonb, numeric, numeric, text, text
) TO service_role;

COMMENT ON FUNCTION public.api_chatgpt_writeback_decision(
  text, uuid, uuid, uuid, text, text, text, jsonb, numeric, numeric, text, text
) IS 'M18.4 approved-only ChatGPT writeback with read-before-write, deterministic dedupe, provenance, conflict stop, audit, and read-after-write.';
