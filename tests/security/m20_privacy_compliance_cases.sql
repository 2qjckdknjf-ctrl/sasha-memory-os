\set ON_ERROR_STOP on

-- M20.4 privacy/compliance acceptance. The fixtures exercise export, derived
-- deletion, connector revocation, telemetry hygiene and retention, then roll
-- back so the suite is repeatable on restored and disposable databases.
BEGIN;

DO $$
DECLARE
  v_secret constant text := 'ci-ephemeral-secret';
  v_owner constant uuid := '33333333-3333-4333-8333-333333333301';
  v_workspace constant uuid := '11111111-1111-4111-8111-111111111111';
  v_project constant uuid := '44444444-4444-4444-8444-444444444402';
  v_other_project constant uuid := '44444444-4444-4444-8444-444444444401';
  v_source constant uuid := '99999999-0000-4000-8000-000000000401';
  v_artifact constant uuid := '99999999-0000-4000-8000-000000000402';
  v_chunk constant uuid := '99999999-0000-4000-8000-000000000403';
  v_primary constant uuid := '99999999-0000-4000-8000-000000000404';
  v_derived constant uuid := '99999999-0000-4000-8000-000000000405';
  v_entity_left constant uuid := '99999999-0000-4000-8000-000000000406';
  v_entity_right constant uuid := '99999999-0000-4000-8000-000000000407';
  v_edge constant uuid := '99999999-0000-4000-8000-000000000408';
  v_audit constant uuid := '99999999-0000-4000-8000-000000000409';
  v_connection constant uuid := '99999999-0000-4000-8000-000000000410';
  v_connection_source constant uuid := '99999999-0000-4000-8000-000000000411';
  v_connection_memory constant uuid := '99999999-0000-4000-8000-000000000412';
  v_connection_job constant uuid := '99999999-0000-4000-8000-000000000413';
  v_connection_outbox constant uuid := '99999999-0000-4000-8000-000000000414';
  v_cross_project_source constant uuid := '99999999-0000-4000-8000-000000000415';
  v_cross_project_memory constant uuid := '99999999-0000-4000-8000-000000000416';
  v_correction_memory constant uuid := '99999999-0000-4000-8000-000000000417';
  v_legacy_request constant uuid := '99999999-0000-4000-8000-000000000418';
  v_third_generation constant uuid := '99999999-0000-4000-8000-000000000419';
  v_retention_memory constant uuid := '99999999-0000-4000-8000-000000000420';
  v_retention_source constant uuid := '99999999-0000-4000-8000-000000000421';
  v_retention_artifact constant uuid := '99999999-0000-4000-8000-000000000422';
  v_retention_chunk constant uuid := '99999999-0000-4000-8000-000000000423';
  v_retention_outbox constant uuid := '99999999-0000-4000-8000-000000000424';
  v_retention_job constant uuid := '99999999-0000-4000-8000-000000000425';
  v_retention_audit constant uuid := '99999999-0000-4000-8000-000000000426';
  v_retention_entity constant uuid := '99999999-0000-4000-8000-000000000427';
  v_task_memory constant uuid := '99999999-0000-4000-8000-000000000428';
  v_unaffected_memory constant uuid := '99999999-0000-4000-8000-000000000429';
  v_other_retention_outbox constant uuid := '99999999-0000-4000-8000-000000000430';
  v_other_retention_job constant uuid := '99999999-0000-4000-8000-000000000431';
  v_other_retention_audit constant uuid := '99999999-0000-4000-8000-000000000432';
  v_routed_correction_memory constant uuid := '99999999-0000-4000-8000-000000000433';
  v_legacy_connection_source constant uuid := '99999999-0000-4000-8000-000000000434';
  v_legacy_connection_memory constant uuid := '99999999-0000-4000-8000-000000000435';
  v_legacy_connection_job constant uuid := '99999999-0000-4000-8000-000000000436';
  v_legacy_connection_outbox constant uuid := '99999999-0000-4000-8000-000000000437';
  v_legacy_connection_artifact constant uuid := '99999999-0000-4000-8000-000000000438';
  v_legacy_connection_chunk constant uuid := '99999999-0000-4000-8000-000000000439';
  v_snapshot_late_memory constant uuid := '99999999-0000-4000-8000-000000000440';
  v_retained_source constant uuid := '99999999-0000-4000-8000-000000000441';
  v_retained_artifact constant uuid := '99999999-0000-4000-8000-000000000442';
  v_retained_chunk constant uuid := '99999999-0000-4000-8000-000000000443';
  v_routed_export_connection constant uuid := '99999999-0000-4000-8000-000000000444';
  v_routed_export_source constant uuid := '99999999-0000-4000-8000-000000000445';
  v_routed_export_artifact constant uuid := '99999999-0000-4000-8000-000000000446';
  v_routed_export_chunk constant uuid := '99999999-0000-4000-8000-000000000447';
  v_routed_export_memory constant uuid := '99999999-0000-4000-8000-000000000448';
  v_marker constant text := 'M20_PRIVACY_SECRET_MARKER_6f9fd9';
  v_vault_ref constant text := 'vault:test/m20/privacy-connector';
  v_created jsonb;
  v_export jsonb;
  v_export_replay jsonb;
  v_export_page_2 jsonb;
  v_result jsonb;
  v_request uuid;
  v_connector_request uuid;
  v_routed_authoritative uuid;
  v_snapshot_at timestamptz;
  v_snapshot_memory_count integer;
  v_mutated_memory uuid;
  v_original_content text;
BEGIN
  INSERT INTO public.source_events (
    id, workspace_id, project_id, provider, event_type, idempotency_key,
    observed_at, recorded_at, sensitivity, storage_mode, payload,
    content_checksum, trace_id, created_by_subject
  ) VALUES (
    v_source, v_workspace, v_project, 'manual', 'privacy.fixture',
    'm20-privacy/source-primary', now(), now(), 'confidential', 'indexed',
    jsonb_build_object('text', v_marker, 'nested', jsonb_build_object('body', v_marker)),
    v_marker, v_marker, v_owner
  );
  INSERT INTO public.artifacts (
    id, workspace_id, project_id, source_event_id, mime_type, storage_mode,
    storage_key, checksum_sha256, byte_size, metadata
  ) VALUES (
    v_artifact, v_workspace, v_project, v_source, 'text/plain', 'indexed',
    'private/' || v_marker, v_marker, 42, jsonb_build_object('body', v_marker)
  );
  INSERT INTO public.artifact_chunks (
    id, workspace_id, artifact_id, chunk_index, content, char_start, char_end,
    metadata
  ) VALUES (
    v_chunk, v_workspace, v_artifact, 0, v_marker, 0, 27,
    jsonb_build_object('body', v_marker)
  );
  INSERT INTO public.memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    sensitivity, source_event_id, created_by_subject, metadata
  ) VALUES
    (
      v_primary, v_workspace, v_project, 'fact', v_marker, v_marker, 'active',
      'confidential', v_source, v_owner, jsonb_build_object('body', v_marker)
    ),
    (
      v_derived, v_workspace, v_project, 'decision', 'Derived ' || v_marker,
      'Derived from ' || v_marker, 'verified', 'confidential', v_source,
      v_owner, jsonb_build_object('derivedFromMemoryId', v_primary, 'body', v_marker)
    ),
    (
      v_third_generation, v_workspace, v_project, 'fact', 'Third generation',
      'Third generation derived content', 'active', 'internal', NULL, v_owner,
      jsonb_build_object('derivedFromMemoryId', v_derived)
    ),
    (
      v_task_memory, v_workspace, v_project, 'task', 'Export typed task',
      'Task portability fixture', 'active', 'internal', NULL, v_owner,
      '{}'::jsonb
    ),
    (
      v_unaffected_memory, v_workspace, v_project, 'fact',
      'Unaffected graph owner', 'Must preserve its entity link', 'active',
      'internal', NULL, v_owner, jsonb_build_object('relatedMemoryId', v_primary)
    );
  INSERT INTO public.memory_evidence (
    memory_id, source_event_id, workspace_id, evidence_span
  ) VALUES (
    v_derived, v_source, v_workspace, jsonb_build_object('quote', v_marker)
  );
  INSERT INTO public.decisions (
    memory_id, workspace_id, rationale, alternatives, decision_maker
  ) VALUES (
    v_derived, v_workspace, v_marker, jsonb_build_array(v_marker), v_marker
  );
  INSERT INTO public.tasks (
    memory_id, workspace_id, owner_subject_id, task_status, priority, due_at,
    dependencies
  ) VALUES (
    v_task_memory, v_workspace, v_owner, 'in_progress', 'high',
    now() + interval '7 days', ARRAY[v_primary]
  );
  INSERT INTO public.entities (
    id, workspace_id, project_id, stable_id, entity_class, canonical_name,
    source_ref, source_event_id, created_from_memory_id, metadata
  ) VALUES
    (
      v_entity_left, v_workspace, v_project, 'm20-privacy-left', 'document',
      v_marker, 'source:' || v_source::text, v_source, v_primary,
      jsonb_build_object('body', v_marker)
    ),
    (
      v_entity_right, v_workspace, v_project, 'm20-privacy-right', 'project',
      'M20 privacy fixture', 'memory:' || v_derived::text, v_source, v_derived,
      '{}'::jsonb
    );
  INSERT INTO public.entity_aliases (
    workspace_id, entity_id, alias, normalized_alias, source_ref,
    source_event_id, memory_id
  ) VALUES (
    v_workspace, v_entity_left, v_marker, lower(v_marker),
    'source:' || v_source::text, v_source, v_primary
  );
  INSERT INTO public.entity_edges (
    id, workspace_id, project_id, from_entity_id, edge_type, to_entity_id,
    source_ref, source_event_id, memory_id, evidence, idempotency_key
  ) VALUES (
    v_edge, v_workspace, v_project, v_entity_left, 'relates_to',
    v_entity_right, 'memory:' || v_primary::text, v_source, v_primary,
    jsonb_build_object('body', v_marker), 'm20-privacy/edge'
  );
  INSERT INTO public.memory_entities (
    workspace_id, project_id, memory_id, entity_id, role, source_ref
  ) VALUES
    (v_workspace, v_project, v_primary, v_entity_left, 'subject', 'privacy-fixture'),
    (v_workspace, v_project, v_derived, v_entity_right, 'project_context', 'privacy-fixture'),
    (v_workspace, v_project, v_unaffected_memory, v_entity_left, 'subject', 'unaffected-fixture');
  INSERT INTO public.audit_log (
    id, workspace_id, actor_subject_id, action, object_type, object_id,
    reason, before_state, after_state
  ) VALUES (
    v_audit, v_workspace, v_owner, 'privacy.fixture.raw', 'memory', v_primary,
    v_marker, jsonb_build_object('body', v_marker), jsonb_build_object('body', v_marker)
  );

  -- A memory routed into the exported project must bring its original source,
  -- artifact/chunks, and non-secret connector account with it.
  INSERT INTO public.connector_accounts (
    id, workspace_id, connector_id, display_name, status, scopes, metadata
  ) VALUES (
    v_routed_export_connection, v_workspace, 'github',
    'Routed export connector', 'connected', ARRAY['repositories.read'], '{}'::jsonb
  );
  INSERT INTO public.source_events (
    id, workspace_id, project_id, connector_account_id, provider, event_type,
    idempotency_key, observed_at, recorded_at, payload, created_by_subject
  ) VALUES (
    v_routed_export_source, v_workspace, v_other_project,
    v_routed_export_connection, 'github', 'privacy.routed.export',
    'm20-privacy/routed-export-source', now(), now(),
    jsonb_build_object('body', v_marker), v_owner
  );
  INSERT INTO public.artifacts (
    id, workspace_id, project_id, source_event_id, storage_mode, storage_key,
    metadata
  ) VALUES (
    v_routed_export_artifact, v_workspace, v_other_project,
    v_routed_export_source, 'indexed', 'routed/' || v_marker,
    jsonb_build_object('body', v_marker)
  );
  INSERT INTO public.artifact_chunks (
    id, workspace_id, artifact_id, chunk_index, content, char_start, char_end
  ) VALUES (
    v_routed_export_chunk, v_workspace, v_routed_export_artifact, 0,
    v_marker, 0, 27
  );
  INSERT INTO public.memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    source_event_id, created_by_subject
  ) VALUES (
    v_routed_export_memory, v_workspace, v_other_project, 'fact',
    'Routed export memory', v_marker, 'active', v_routed_export_source, v_owner
  );
  INSERT INTO public.project_routing_corrections (
    workspace_id, memory_id, previous_project_id, corrected_project_id,
    classification, reason, source_evidence, actor_subject_id
  ) VALUES (
    v_workspace, v_routed_export_memory, v_other_project, v_project,
    'MOVE_TO_MEMORY_OS', 'M20.4 routed export fixture', '{}'::jsonb, v_owner
  );

  v_export := public.api_export_project_privacy_bundle(
    v_secret, v_owner, v_workspace, v_project, 500
  );
  IF v_export->>'format' <> 'memory-os.privacy-export.v1'
     OR v_export::text NOT LIKE '%' || v_marker || '%'
     OR NOT (v_export->'memories' @> jsonb_build_array(jsonb_build_object('id', v_primary)))
     OR NOT (v_export->'memories' @> jsonb_build_array(jsonb_build_object(
       'id', v_derived, 'decision', jsonb_build_object('rationale', v_marker)
     )))
     OR NOT (v_export->'memories' @> jsonb_build_array(jsonb_build_object(
       'id', v_task_memory, 'task', jsonb_build_object(
         'status', 'in_progress', 'priority', 'high'
       )
     )))
     OR NOT (v_export->'memories' @> jsonb_build_array(jsonb_build_object(
       'id', v_routed_export_memory, 'projectId', v_project,
       'storedProjectId', v_other_project
     )))
     OR NOT (v_export->'sourceEvents' @> jsonb_build_array(jsonb_build_object(
       'id', v_routed_export_source
     )))
     OR NOT (v_export->'artifacts' @> jsonb_build_array(jsonb_build_object(
       'id', v_routed_export_artifact,
       'chunks', jsonb_build_array(jsonb_build_object('content', v_marker))
     )))
     OR NOT (v_export->'connectorAccounts' @> jsonb_build_array(jsonb_build_object(
       'id', v_routed_export_connection
     ))) THEN
    RAISE EXCEPTION 'privacy export omitted source, primary, or derived data: %', v_export;
  END IF;
  -- The acceptance body is one SQL statement, so use its stable start time to
  -- model the snapshot returned by the first HTTP/RPC request.
  v_snapshot_at := statement_timestamp();
  v_export := public.api_export_project_privacy_bundle(
    v_secret, v_owner, v_workspace, v_project, 1, 0, v_snapshot_at
  );
  v_snapshot_memory_count := (v_export->'counts'->>'memories')::integer;
  v_mutated_memory := (v_export->'memories'->0->>'id')::uuid;
  SELECT content INTO v_original_content
  FROM public.memory_records
  WHERE id = v_mutated_memory;
  UPDATE public.memory_records
  SET content = 'mutated after export snapshot'
  WHERE id = v_mutated_memory;
  INSERT INTO public.memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    recorded_at, created_by_subject
  ) VALUES (
    v_snapshot_late_memory, v_workspace, v_project, 'fact',
    'Created after export snapshot', 'Must not shift later pages', 'active',
    v_snapshot_at + interval '1 second', v_owner
  );
  v_export_replay := public.api_export_project_privacy_bundle(
    v_secret, v_owner, v_workspace, v_project, 1, 0, v_snapshot_at,
    (v_export->>'exportId')::uuid
  );
  v_export_page_2 := public.api_export_project_privacy_bundle(
    v_secret, v_owner, v_workspace, v_project, 1, 1, v_snapshot_at,
    (v_export->>'exportId')::uuid
  );
  IF coalesce((v_export->'pagination'->>'hasMore')::boolean, false) IS NOT TRUE
     OR (v_export->'pagination'->>'nextOffset')::integer <> 1
     OR (v_export->>'snapshotAt')::timestamptz <> v_snapshot_at
     OR (v_export_page_2->>'snapshotAt')::timestamptz <> v_snapshot_at
     OR v_export_replay->>'exportId' <> v_export->>'exportId'
     OR v_export_page_2->>'exportId' <> v_export->>'exportId'
     OR v_export_replay->'memories' IS DISTINCT FROM v_export->'memories'
     OR (v_export_page_2->'counts'->>'memories')::integer <> v_snapshot_memory_count
     OR v_export_page_2::text LIKE '%' || v_snapshot_late_memory::text || '%'
     OR v_export_replay::text LIKE '%mutated after export snapshot%'
     OR jsonb_array_length(v_export->'memories') > 1
     OR jsonb_array_length(v_export->'sourceEvents') > 1
     OR jsonb_array_length(v_export->'artifacts') > 1
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_export->'memories') first_page
       JOIN jsonb_array_elements(v_export_page_2->'memories') second_page
         ON first_page->>'id' = second_page->>'id'
     ) THEN
    RAISE EXCEPTION 'privacy export pagination is incomplete or unstable: %, %',
      v_export, v_export_page_2;
  END IF;
  UPDATE public.memory_records
  SET content = v_original_content
  WHERE id = v_mutated_memory;

  v_created := public.api_create_privacy_request_v2(
    v_secret, v_owner, v_workspace, v_project, 'deletion', v_primary, NULL,
    'erase ' || v_marker, NULL, 'm20-privacy/delete-derived'
  );
  v_request := (v_created->>'id')::uuid;
  v_result := public.api_execute_privacy_request(v_secret, v_owner, v_request);
  IF v_result->>'status' <> 'completed'
     OR (v_result->'resultSummary'->>'affectedMemoryCount')::integer <> 3 THEN
    RAISE EXCEPTION 'derived deletion did not complete: %', v_result;
  END IF;
  v_result := public.api_execute_privacy_request(v_secret, v_owner, v_request);
  IF coalesce((v_result->>'idempotent')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'privacy execution replay was not idempotent: %', v_result;
  END IF;
  IF (SELECT count(*) FROM public.memory_records m
      WHERE m.id IN (v_primary, v_derived, v_third_generation)
        AND m.status = 'deleted'
        AND m.content = '[deleted by privacy request]'
        AND m.embedding IS NULL
        AND m.embedding_vector IS NULL
        AND m.embedding_vector_hq IS NULL) <> 3 THEN
    RAISE EXCEPTION 'primary or recursive derived memory retained content/embedding';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memory_records m
    WHERE m.id = v_unaffected_memory
      AND m.status = 'active'
      AND m.content = 'Must preserve its entity link'
  ) THEN
    RAISE EXCEPTION 'unrelated metadata reference caused collateral memory erasure';
  END IF;
  IF EXISTS (SELECT 1 FROM public.memory_evidence WHERE memory_id IN (v_primary, v_derived))
     OR EXISTS (SELECT 1 FROM public.artifact_chunks WHERE artifact_id = v_artifact)
     OR EXISTS (SELECT 1 FROM public.entities WHERE id = v_entity_right)
     OR NOT EXISTS (
       SELECT 1 FROM public.entities e
       WHERE e.id = v_entity_left
         AND e.canonical_name = 'Redacted shared entity'
         AND e.source_event_id IS NULL
         AND e.created_from_memory_id IS NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.memory_entities me
       WHERE me.memory_id = v_unaffected_memory AND me.entity_id = v_entity_left
     )
     OR EXISTS (SELECT 1 FROM public.entity_edges WHERE id = v_edge) THEN
    RAISE EXCEPTION 'derived evidence/artifacts survived or unrelated graph ownership was lost';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.source_events s
    WHERE s.id = v_source AND s.payload::text LIKE '%' || v_marker || '%'
  ) OR EXISTS (
    SELECT 1 FROM public.artifacts a
    WHERE a.id = v_artifact AND (
      coalesce(a.storage_key, '') LIKE '%' || v_marker || '%'
      OR a.metadata::text LIKE '%' || v_marker || '%'
    )
  ) THEN
    RAISE EXCEPTION 'source event or artifact retained erased content';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.audit_log a
    WHERE a.workspace_id = v_workspace
      AND concat_ws(' ', a.reason, a.before_state::text, a.after_state::text)
          LIKE '%' || v_marker || '%'
  ) THEN
    RAISE EXCEPTION 'sensitive content leaked into operational audit state';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.privacy_requests r
    WHERE r.id = v_request
      AND (r.reason LIKE '%' || v_marker || '%' OR r.correction_text LIKE '%' || v_marker || '%')
  ) THEN
    RAISE EXCEPTION 'completed privacy request retained sensitive free text';
  END IF;

  -- Legacy requests created before the v2 route must fail closed instead of
  -- becoming completed no-ops, and correction audits must not retain bodies.
  INSERT INTO public.privacy_requests (
    id, workspace_id, project_id, actor_subject_id, request_type, status,
    reason, idempotency_key
  ) VALUES (
    v_legacy_request, v_workspace, v_project, v_owner, 'deletion', 'submitted',
    'legacy request without target', 'm20-privacy/legacy-no-target'
  );
  BEGIN
    PERFORM public.api_execute_privacy_request(v_secret, v_owner, v_legacy_request);
    RAISE EXCEPTION 'legacy request without a target unexpectedly executed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'legacy request without a target unexpectedly executed' THEN
      RAISE;
    END IF;
  END;
  IF NOT EXISTS (
    SELECT 1 FROM public.privacy_requests r
    WHERE r.id = v_legacy_request AND r.status = 'submitted'
  ) THEN
    RAISE EXCEPTION 'invalid legacy request was mutated before validation';
  END IF;

  INSERT INTO public.memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    created_by_subject
  ) VALUES (
    v_correction_memory, v_workspace, v_project, 'fact', v_marker, v_marker,
    'active', v_owner
  );
  v_created := public.api_create_privacy_request_v2(
    v_secret, v_owner, v_workspace, v_project, 'correction',
    v_correction_memory, NULL, 'correct ' || v_marker,
    'authoritative ' || v_marker, 'm20-privacy/correction-audit'
  );
  v_result := public.api_execute_privacy_request(
    v_secret, v_owner, (v_created->>'id')::uuid
  );
  IF v_result->>'status' <> 'completed' OR EXISTS (
    SELECT 1 FROM public.audit_log a
    WHERE a.workspace_id = v_workspace
      AND a.action IN ('memory.correct', 'privacy.request.completed')
      AND concat_ws(' ', a.reason, a.before_state::text, a.after_state::text)
          LIKE '%' || v_marker || '%'
  ) THEN
    RAISE EXCEPTION 'privacy correction leaked sensitive content into audit: %', v_result;
  END IF;

  -- A correction of a routed memory must keep the authoritative replacement
  -- in the request's effective project, not silently return it to stored scope.
  INSERT INTO public.memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    created_by_subject
  ) VALUES (
    v_routed_correction_memory, v_workspace, v_other_project, 'fact',
    'Routed correction target', 'Stored in the previous project', 'active', v_owner
  );
  INSERT INTO public.project_routing_corrections (
    workspace_id, memory_id, previous_project_id, corrected_project_id,
    classification, reason, source_evidence, actor_subject_id
  ) VALUES (
    v_workspace, v_routed_correction_memory, v_other_project, v_project,
    'MOVE_TO_MEMORY_OS', 'M20.4 routed correction fixture', '{}'::jsonb, v_owner
  );
  v_created := public.api_create_privacy_request_v2(
    v_secret, v_owner, v_workspace, v_project, 'correction',
    v_routed_correction_memory, NULL, 'correct routed memory',
    'authoritative routed content', 'm20-privacy/correction-routing'
  );
  v_result := public.api_execute_privacy_request(
    v_secret, v_owner, (v_created->>'id')::uuid
  );
  v_routed_authoritative :=
    (v_result->'resultSummary'->>'authoritativeMemoryId')::uuid;
  IF v_result->>'status' <> 'completed'
     OR app.effective_memory_project_id(v_routed_authoritative) <> v_project
     OR NOT EXISTS (
       SELECT 1 FROM public.project_routing_corrections prc
       WHERE prc.memory_id = v_routed_authoritative
         AND prc.previous_project_id = v_other_project
         AND prc.corrected_project_id = v_project
         AND prc.classification = 'MOVE_TO_MEMORY_OS'
     ) THEN
    RAISE EXCEPTION 'privacy correction lost effective project routing: %', v_result;
  END IF;

  INSERT INTO public.connector_accounts (
    id, workspace_id, connector_id, display_name, status, scopes, metadata
  ) VALUES (
    v_connection, v_workspace, 'github', 'M20.4 privacy source', 'connected',
    ARRAY['repositories.read'], jsonb_build_object('tokenHint', v_marker)
  );
  PERFORM app.api_vault_put(
    v_secret,
    v_vault_ref,
    encode(convert_to('connector-' || v_marker, 'UTF8'), 'base64')
  );
  INSERT INTO public.connector_secrets (
    workspace_id, connector_account_id, vault_ref, key_purpose
  ) VALUES (v_workspace, v_connection, v_vault_ref, 'oauth_access');
  INSERT INTO public.connector_cursors (
    account_id, stream, opaque_cursor
  ) VALUES (v_connection, 'events', jsonb_build_object('cursor', v_marker));
  INSERT INTO public.source_events (
    id, workspace_id, project_id, connector_account_id, provider, event_type,
    idempotency_key, observed_at, payload, created_by_subject
  ) VALUES (
    v_connection_source, v_workspace, v_project, v_connection, 'github',
    'connector.privacy.fixture', 'm20-privacy/connector-source', now(),
    jsonb_build_object('body', v_marker), v_owner
  );
  -- Legacy api_capture_connector_record rows carry the account only in the
  -- payload and use source_event/job_id queue linkage without connectionId.
  INSERT INTO public.source_events (
    id, workspace_id, project_id, provider, event_type, idempotency_key,
    observed_at, payload, created_by_subject
  ) VALUES (
    v_legacy_connection_source, v_workspace, v_project, 'github',
    'connector.capture.legacy', 'm20-privacy/legacy-connector-source', now(),
    jsonb_build_object(
      'source', jsonb_build_object('account_id', v_connection),
      'content', jsonb_build_object('text', v_marker)
    ),
    v_owner
  );
  INSERT INTO public.source_events (
    id, workspace_id, project_id, connector_account_id, provider, event_type,
    idempotency_key, observed_at, payload, created_by_subject
  ) VALUES (
    v_cross_project_source, v_workspace, v_other_project, v_connection, 'github',
    'connector.privacy.cross-project', 'm20-privacy/cross-project-source', now(),
    jsonb_build_object('body', v_marker), v_owner
  );
  INSERT INTO public.memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    source_event_id, created_by_subject
  ) VALUES (
    v_connection_memory, v_workspace, v_project, 'fact', v_marker, v_marker,
    'active', v_connection_source, v_owner
  );
  INSERT INTO public.memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    source_event_id, created_by_subject
  ) VALUES (
    v_cross_project_memory, v_workspace, v_other_project, 'fact', v_marker,
    v_marker, 'active', v_cross_project_source, v_owner
  );
  INSERT INTO public.memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    source_event_id, created_by_subject
  ) VALUES (
    v_legacy_connection_memory, v_workspace, v_project, 'fact', v_marker,
    v_marker, 'active', v_legacy_connection_source, v_owner
  );
  INSERT INTO public.artifacts (
    id, workspace_id, project_id, source_event_id, storage_mode, storage_key,
    metadata
  ) VALUES (
    v_legacy_connection_artifact, v_workspace, v_project,
    v_legacy_connection_source, 'indexed', 'private/' || v_marker,
    jsonb_build_object('body', v_marker)
  );
  INSERT INTO public.artifact_chunks (
    id, workspace_id, artifact_id, chunk_index, content, char_start, char_end
  ) VALUES (
    v_legacy_connection_chunk, v_workspace, v_legacy_connection_artifact,
    0, v_marker, 0, 27
  );
  INSERT INTO public.processing_jobs (
    id, workspace_id, job_type, status, source_event_id, idempotency_key
  ) VALUES (
    v_connection_job, v_workspace, 'connector_sync', 'queued',
    v_connection_source, 'm20-privacy/connector-job'
  );
  INSERT INTO public.processing_jobs (
    id, workspace_id, job_type, status, source_event_id, idempotency_key
  ) VALUES (
    v_legacy_connection_job, v_workspace, 'ingest', 'queued',
    v_legacy_connection_source, 'm20-privacy/legacy-connector-job'
  );
  INSERT INTO public.outbox_events (
    id, workspace_id, aggregate_type, aggregate_id, event_type, payload
  ) VALUES (
    v_connection_outbox, v_workspace, 'connector_account', v_connection,
    'connector.sync.requested', jsonb_build_object(
      'connectionId', v_connection, 'jobId', v_connection_job
    )
  );
  INSERT INTO public.outbox_events (
    id, workspace_id, aggregate_type, aggregate_id, event_type, payload
  ) VALUES (
    v_legacy_connection_outbox, v_workspace, 'source_event',
    v_legacy_connection_source, 'connector.capture.queued',
    jsonb_build_object(
      'job_id', v_legacy_connection_job,
      'artifact_id', v_legacy_connection_artifact
    )
  );

  v_created := public.api_create_privacy_request_v2(
    v_secret, v_owner, v_workspace, v_project, 'deletion', NULL, v_connection,
    'revoke connector source', NULL, 'm20-privacy/revoke-connector'
  );
  v_connector_request := (v_created->>'id')::uuid;
  v_result := public.api_execute_privacy_request(
    v_secret, v_owner, v_connector_request
  );
  IF v_result->>'status' <> 'completed'
     OR coalesce((v_result->'resultSummary'->>'sourceRevoked')::boolean, false) IS NOT TRUE
     OR (v_result->'resultSummary'->>'stoppedJobCount')::integer <> 2 THEN
    RAISE EXCEPTION 'connector revocation privacy request failed: %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.connector_accounts c
    WHERE c.id = v_connection AND c.status = 'revoked'
  ) OR EXISTS (
    SELECT 1 FROM public.connector_secrets WHERE connector_account_id = v_connection
  ) OR EXISTS (
    SELECT 1 FROM public.connector_cursors WHERE account_id = v_connection
  ) OR EXISTS (
    SELECT 1 FROM public.connector_vault_blobs WHERE vault_ref = v_vault_ref
  ) THEN
    RAISE EXCEPTION 'connector account, secret, cursor, or vault payload was not revoked';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.processing_jobs j
    WHERE j.id = v_connection_job AND j.status = 'dead_letter'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.processing_jobs j
    WHERE j.id = v_legacy_connection_job AND j.status = 'dead_letter'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.outbox_events o
    WHERE o.id = v_connection_outbox AND o.published_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.outbox_events o
    WHERE o.id = v_legacy_connection_outbox AND o.published_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.memory_records m
    WHERE m.id = v_connection_memory AND m.status = 'deleted'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.memory_records m
    WHERE m.id = v_cross_project_memory AND m.status = 'deleted'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.memory_records m
    WHERE m.id = v_legacy_connection_memory AND m.status = 'deleted'
  ) OR EXISTS (
    SELECT 1 FROM public.artifact_chunks c
    WHERE c.id = v_legacy_connection_chunk
  ) OR EXISTS (
    SELECT 1 FROM public.source_events s
    WHERE s.id = v_legacy_connection_source
      AND s.payload::text LIKE '%' || v_marker || '%'
  ) THEN
    RAISE EXCEPTION 'connector-derived jobs, outbox, or cross-project memory were not revoked';
  END IF;

  INSERT INTO public.memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    recorded_at, created_by_subject
  ) VALUES (
    v_retention_memory, v_workspace, v_project, 'fact', v_marker, v_marker,
    'candidate', now() - interval '91 days', v_owner
  );
  INSERT INTO public.source_events (
    id, workspace_id, project_id, provider, event_type, idempotency_key,
    observed_at, recorded_at, payload, created_by_subject
  ) VALUES (
    v_retention_source, v_workspace, v_project, 'manual', 'retention.fixture',
    'm20-privacy/retention-source', now() - interval '181 days',
    now() - interval '181 days', jsonb_build_object('body', v_marker), v_owner
  );
  INSERT INTO public.source_events (
    id, workspace_id, project_id, provider, event_type, idempotency_key,
    observed_at, recorded_at, payload, created_by_subject
  ) VALUES (
    v_retained_source, v_workspace, v_project, 'manual',
    'retention.processed.fixture', 'm20-privacy/retained-source',
    now() - interval '181 days', now() - interval '181 days',
    jsonb_build_object('body', v_marker), v_owner
  );
  INSERT INTO public.entities (
    id, workspace_id, project_id, stable_id, entity_class, canonical_name,
    source_ref, created_from_memory_id, metadata
  ) VALUES (
    v_retention_entity, v_workspace, v_project, 'm20-retention-entity',
    'document', v_marker, 'memory:' || v_retention_memory::text,
    v_retention_memory, jsonb_build_object('body', v_marker)
  );
  INSERT INTO public.memory_entities (
    workspace_id, project_id, memory_id, entity_id, role, source_ref
  ) VALUES
    (
      v_workspace, v_project, v_retention_memory, v_retention_entity, 'subject',
      'retention-fixture'
    ),
    (
      v_workspace, v_project, v_unaffected_memory, v_retention_entity,
      'project_context',
      'retention-shared-fixture'
    );
  INSERT INTO public.artifacts (
    id, workspace_id, project_id, source_event_id, storage_mode, storage_key,
    metadata, created_at
  ) VALUES (
    v_retention_artifact, v_workspace, v_project, v_retention_source, 'indexed',
    'private/' || v_marker,
    jsonb_build_object('body', v_marker, 'quarantine', true),
    now() - interval '181 days'
  );
  INSERT INTO public.artifacts (
    id, workspace_id, project_id, source_event_id, storage_mode, storage_key,
    metadata, created_at
  ) VALUES (
    v_retained_artifact, v_workspace, v_project, v_retained_source, 'indexed',
    'processed/' || v_marker,
    jsonb_build_object('body', v_marker, 'quarantine', false),
    now() - interval '181 days'
  );
  INSERT INTO public.artifact_chunks (
    id, workspace_id, artifact_id, chunk_index, content, char_start, char_end
  ) VALUES (
    v_retention_chunk, v_workspace, v_retention_artifact, 0, v_marker, 0, 27
  );
  INSERT INTO public.artifact_chunks (
    id, workspace_id, artifact_id, chunk_index, content, char_start, char_end
  ) VALUES (
    v_retained_chunk, v_workspace, v_retained_artifact, 0, v_marker, 0, 27
  );
  INSERT INTO public.outbox_events (
    id, workspace_id, aggregate_type, aggregate_id, event_type, payload,
    created_at, published_at
  ) VALUES (
    v_retention_outbox, v_workspace, 'memory', v_retention_memory,
    'retention.fixture', '{}'::jsonb, now() - interval '31 days',
    now() - interval '31 days'
  );
  INSERT INTO public.processing_jobs (
    id, workspace_id, job_type, status, source_event_id, idempotency_key,
    created_at, updated_at
  ) VALUES (
    v_retention_job, v_workspace, 'ingest', 'dead_letter',
    v_retention_source, 'm20-privacy/retention-job',
    now() - interval '91 days', now() - interval '91 days'
  );
  INSERT INTO public.audit_log (
    id, workspace_id, actor_subject_id, action, object_type, object_id, reason,
    recorded_at
  ) VALUES (
    v_retention_audit, v_workspace, v_owner, 'retention.fixture', 'memory',
    v_retention_memory, 'retention fixture', now() - interval '366 days'
  );
  INSERT INTO public.outbox_events (
    id, workspace_id, aggregate_type, aggregate_id, event_type, payload,
    created_at, published_at
  ) VALUES (
    v_other_retention_outbox, v_workspace, 'memory', v_cross_project_memory,
    'retention.other-project', '{}'::jsonb, now() - interval '31 days',
    now() - interval '31 days'
  );
  INSERT INTO public.processing_jobs (
    id, workspace_id, job_type, status, source_event_id, idempotency_key,
    created_at, updated_at
  ) VALUES (
    v_other_retention_job, v_workspace, 'ingest', 'dead_letter',
    v_cross_project_source, 'm20-privacy/other-retention-job',
    now() - interval '91 days', now() - interval '91 days'
  );
  INSERT INTO public.audit_log (
    id, workspace_id, actor_subject_id, action, object_type, object_id, reason,
    recorded_at
  ) VALUES (
    v_other_retention_audit, v_workspace, v_owner, 'retention.other-project',
    'memory', v_cross_project_memory, 'must survive project retention',
    now() - interval '366 days'
  );

  BEGIN
    PERFORM public.api_apply_retention_policy(
      v_secret, v_owner, v_workspace, v_project,
      statement_timestamp() + interval '1 day', false
    );
    RAISE EXCEPTION 'future retention cutoff unexpectedly executed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'future retention cutoff unexpectedly executed' THEN
      RAISE;
    END IF;
    IF SQLSTATE <> '22023' THEN
      RAISE;
    END IF;
  END;
  IF NOT EXISTS (
    SELECT 1 FROM public.memory_records
    WHERE id = v_retention_memory AND status = 'candidate'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.artifact_chunks WHERE id = v_retention_chunk
  ) THEN
    RAISE EXCEPTION 'future retention cutoff mutated data';
  END IF;

  v_result := public.api_apply_retention_policy(
    v_secret, v_owner, v_workspace, v_project, now(), true
  );
  IF (v_result->>'candidateMemories')::integer < 1
     OR (v_result->>'quarantineArtifacts')::integer < 1
     OR (v_result->>'publishedOutboxEvents')::integer < 1
     OR (v_result->>'deadLetterJobs')::integer < 1
     OR (v_result->>'auditEvents')::integer < 1 THEN
    RAISE EXCEPTION 'retention preview omitted expired fixtures: %', v_result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.memory_records WHERE id = v_retention_memory AND status = 'candidate')
     OR NOT EXISTS (SELECT 1 FROM public.artifact_chunks WHERE id = v_retention_chunk)
     OR NOT EXISTS (SELECT 1 FROM public.outbox_events WHERE id = v_retention_outbox) THEN
    RAISE EXCEPTION 'retention preview mutated data';
  END IF;

  v_result := public.api_apply_retention_policy(
    v_secret, v_owner, v_workspace, v_project, now(), false
  );
  IF coalesce((v_result->>'dryRun')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'retention apply did not report dryRun=false: %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memory_records m
    WHERE m.id = v_retention_memory
      AND m.status = 'deleted'
      AND m.content = '[expired by retention policy]'
  ) OR EXISTS (
    SELECT 1 FROM public.artifact_chunks WHERE id = v_retention_chunk
  ) OR EXISTS (
    SELECT 1 FROM public.outbox_events WHERE id = v_retention_outbox
  ) OR EXISTS (
    SELECT 1 FROM public.processing_jobs WHERE id = v_retention_job
  ) OR EXISTS (
    SELECT 1 FROM public.audit_log WHERE id = v_retention_audit
  ) OR NOT EXISTS (
    SELECT 1 FROM public.entities e
    WHERE e.id = v_retention_entity
      AND e.canonical_name = 'Redacted retained entity'
      AND e.created_from_memory_id IS NULL
      AND e.source_event_id IS NULL
      AND e.metadata->>'retentionSourceRemoved' = 'true'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.memory_entities me
    WHERE me.memory_id = v_unaffected_memory
      AND me.entity_id = v_retention_entity
  ) OR EXISTS (
    SELECT 1 FROM public.source_events s
    WHERE s.id = v_retention_source AND s.payload::text LIKE '%' || v_marker || '%'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.artifact_chunks WHERE id = v_retained_chunk
  ) OR NOT EXISTS (
    SELECT 1 FROM public.artifacts a
    WHERE a.id = v_retained_artifact
      AND a.storage_key = 'processed/' || v_marker
      AND a.metadata @> '{"quarantine": false}'::jsonb
  ) OR NOT EXISTS (
    SELECT 1 FROM public.source_events s
    WHERE s.id = v_retained_source
      AND s.payload::text LIKE '%' || v_marker || '%'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.outbox_events WHERE id = v_other_retention_outbox
  ) OR NOT EXISTS (
    SELECT 1 FROM public.processing_jobs WHERE id = v_other_retention_job
  ) OR NOT EXISTS (
    SELECT 1 FROM public.audit_log WHERE id = v_other_retention_audit
  ) THEN
    RAISE EXCEPTION 'retention apply missed scoped rows or crossed the project boundary';
  END IF;

  IF has_function_privilege(
    'anon', 'public.api_execute_privacy_request(text,uuid,uuid)', 'EXECUTE'
  ) OR has_function_privilege(
    'authenticated', 'public.api_execute_privacy_request(text,uuid,uuid)', 'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role', 'public.api_execute_privacy_request(text,uuid,uuid)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'privacy executor role boundary is not server-only';
  END IF;
  IF has_function_privilege(
    'anon', 'public.api_export_project_privacy_bundle(text,uuid,uuid,uuid,integer,integer,timestamptz,uuid)', 'EXECUTE'
  ) OR has_function_privilege(
    'authenticated', 'public.api_export_project_privacy_bundle(text,uuid,uuid,uuid,integer,integer,timestamptz,uuid)', 'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role', 'public.api_export_project_privacy_bundle(text,uuid,uuid,uuid,integer,integer,timestamptz,uuid)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'privacy export role boundary is not server-only';
  END IF;
  IF has_table_privilege('anon', 'public.privacy_export_snapshots', 'SELECT')
     OR has_table_privilege(
       'authenticated', 'public.privacy_export_snapshots', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'privacy export snapshots are directly readable';
  END IF;
END;
$$;

ROLLBACK;

\echo m20_privacy_compliance_cases=pass
