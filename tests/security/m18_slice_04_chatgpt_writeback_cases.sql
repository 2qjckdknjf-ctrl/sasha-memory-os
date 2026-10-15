\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_workspace constant uuid := '11111111-1111-4111-8111-111111111111';
  v_project constant uuid := '44444444-4444-4444-8444-444444444402';
  v_owner constant uuid := '33333333-3333-4333-8333-333333333301';
  v_chatgpt constant uuid := '33333333-3333-4333-8333-333333333302';
  v_secret text;
  v_envelope jsonb := jsonb_build_object(
    'kind', 'approved_decision',
    'approval', jsonb_build_object(
      'source', 'explicit_user',
      'reference', 'security-test:explicit-approval'
    ),
    'evidence_refs', jsonb_build_array('security-test:evidence-1')
  );
  v_created jsonb;
  v_deduplicated jsonb;
  v_conflict jsonb;
  v_memory_id uuid;
  v_before_count bigint;
  v_after_count bigint;
  v_rejected boolean;
BEGIN
  SELECT value INTO STRICT v_secret
  FROM app.runtime_config
  WHERE key = 'api_secret';

  v_created := public.api_chatgpt_writeback_decision(
    v_secret,
    v_chatgpt,
    v_workspace,
    v_project,
    'M18.4 security test decision',
    'Use the approved automatic writeback policy for this test.',
    'm18-s04-security-created',
    v_envelope,
    0.8,
    0.9,
    'internal',
    'Security acceptance case'
  );
  v_memory_id := (v_created#>>'{memory,id}')::uuid;

  IF v_memory_id IS NULL
     OR v_created#>>'{writeback,outcome}' <> 'created'
     OR (v_created#>>'{writeback,readBeforeWrite}')::boolean IS DISTINCT FROM true
     OR (v_created#>>'{writeback,readAfterWrite}')::boolean IS DISTINCT FROM true
     OR (v_created#>>'{memory,projectId}')::uuid IS DISTINCT FROM v_project
     OR (v_created#>>'{memory,createdBySubject}')::uuid IS DISTINCT FROM v_chatgpt
     OR v_created#>>'{memory,status}' <> 'verified' THEN
    RAISE EXCEPTION 'valid approved ChatGPT writeback did not create and verify one memory';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM memory_records m
    JOIN source_events se ON se.id = m.source_event_id
    WHERE m.id = v_memory_id
      AND m.metadata#>>'{chatgptWriteback,packVersion}' = 'm18-s04-v1'
      AND m.metadata#>>'{chatgptWriteback,approval,source}' = 'explicit_user'
      AND m.metadata#>>'{chatgptWriteback,evidenceRefs,0}' = 'security-test:evidence-1'
      AND se.provider = 'chatgpt'
      AND se.event_type = 'chatgpt.writeback.approved'
      AND se.payload#>>'{chatgptWriteback,fingerprint}' = m.metadata#>>'{chatgptWriteback,fingerprint}'
      AND se.content_checksum = m.metadata#>>'{chatgptWriteback,fingerprint}'
  ) THEN
    RAISE EXCEPTION 'writeback provenance was not preserved on memory and source event';
  END IF;

  v_deduplicated := public.api_chatgpt_writeback_decision(
    v_secret,
    v_chatgpt,
    v_workspace,
    v_project,
    'M18.4 security test decision',
    'Use the approved automatic writeback policy for this test.',
    'm18-s04-security-deduplicated',
    v_envelope
  );
  IF (v_deduplicated#>>'{memory,id}')::uuid IS DISTINCT FROM v_memory_id
     OR v_deduplicated#>>'{writeback,outcome}' <> 'deduplicated'
     OR (v_deduplicated#>>'{writeback,deduplicated}')::boolean IS DISTINCT FROM true
     OR (v_deduplicated#>>'{writeback,readAfterWrite}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'exact writeback duplicate did not reuse verified memory';
  END IF;

  SELECT count(*) INTO v_before_count
  FROM memory_records
  WHERE workspace_id = v_workspace
    AND project_id = v_project
    AND lower(btrim(title)) = lower('M18.4 security test decision');

  v_conflict := public.api_chatgpt_writeback_decision(
    v_secret,
    v_chatgpt,
    v_workspace,
    v_project,
    'M18.4 security test decision',
    'This different content must not overwrite the approved memory.',
    'm18-s04-security-conflict',
    v_envelope
  );
  SELECT count(*) INTO v_after_count
  FROM memory_records
  WHERE workspace_id = v_workspace
    AND project_id = v_project
    AND lower(btrim(title)) = lower('M18.4 security test decision');

  IF v_conflict#>>'{writeback,outcome}' <> 'review_required'
     OR (v_conflict#>>'{writeback,writePerformed}')::boolean IS DISTINCT FROM false
     OR (v_conflict#>>'{writeback,conflictMemoryId}')::uuid IS DISTINCT FROM v_memory_id
     OR v_after_count IS DISTINCT FROM v_before_count THEN
    RAISE EXCEPTION 'same-title conflict was not stopped for review';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.api_chatgpt_writeback_decision(
      v_secret,
      v_chatgpt,
      v_workspace,
      v_project,
      'M18.4 missing evidence',
      'This write must be rejected.',
      'm18-s04-security-missing-evidence',
      jsonb_build_object(
        'kind', 'approved_decision',
        'approval', jsonb_build_object(
          'source', 'explicit_user',
          'reference', 'security-test:explicit-approval'
        ),
        'evidence_refs', '[]'::jsonb
      )
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'missing writeback evidence was accepted';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.api_chatgpt_writeback_decision(
      v_secret,
      v_owner,
      v_workspace,
      v_project,
      'M18.4 wrong subject',
      'This write must be rejected.',
      'm18-s04-security-wrong-subject',
      v_envelope
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'non-ChatGPT subject was allowed to use automatic writeback';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM audit_log
    WHERE workspace_id = v_workspace
      AND actor_subject_id = v_chatgpt
      AND object_id = v_memory_id
      AND action = 'chatgpt.writeback.created'
      AND (after_state->>'readAfterWrite')::boolean IS TRUE
  ) OR NOT EXISTS (
    SELECT 1
    FROM audit_log
    WHERE workspace_id = v_workspace
      AND actor_subject_id = v_chatgpt
      AND object_id = v_memory_id
      AND action = 'chatgpt.writeback.deduplicated'
  ) OR NOT EXISTS (
    SELECT 1
    FROM audit_log
    WHERE workspace_id = v_workspace
      AND actor_subject_id = v_chatgpt
      AND object_id = v_memory_id
      AND action = 'chatgpt.writeback.review_required'
  ) THEN
    RAISE EXCEPTION 'writeback audit trail is incomplete';
  END IF;
END;
$$;

ROLLBACK;

\echo m18_slice_04_chatgpt_writeback_cases=pass
