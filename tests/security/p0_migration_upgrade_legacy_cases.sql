-- Legacy upgrade regression: pre-seeded corrections/personalizations survive P0 re-apply semantics.
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_memory_id uuid := 'dddddddd-dddd-4ddd-8ddd-ddddddddddd01';
  v_aistroyka uuid := '44444444-4444-4444-8444-444444444401';
  v_memory_os uuid := '44444444-4444-4444-8444-444444444402';
  v_workspace uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '33333333-3333-4333-8333-333333333301';
  v_cursor uuid := '33333333-3333-4333-8333-333333333303';
  v_secret text;
  v_reason text;
  v_hits jsonb;
BEGIN
  v_secret := (SELECT value FROM app.runtime_config WHERE key = 'api_secret');

  INSERT INTO memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    sensitivity, importance, confidence, schema_version, recorded_at, observed_at
  ) VALUES (
    v_memory_id, v_workspace, v_aistroyka, 'decision',
    'Legacy upgrade routing memory', 'Pre-seeded before upgrade replay', 'active',
    'internal', 0.6, 1.0, 1, now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO project_routing_corrections (
    workspace_id, memory_id, previous_project_id, corrected_project_id,
    classification, reason, source_evidence, actor_subject_id
  ) VALUES (
    v_workspace, v_memory_id, v_aistroyka, v_memory_os,
    'MOVE_TO_MEMORY_OS', 'legacy_routing_correction_preserved', '{}'::jsonb, v_owner
  )
  ON CONFLICT (memory_id) DO UPDATE SET
    reason = EXCLUDED.reason;

  INSERT INTO memory_personalizations (
    workspace_id, project_id, memory_id, scope, scope_key,
    actor_subject_id, pinned, importance_delta, ranking_version, version, updated_by_subject
  ) VALUES (
    v_workspace, v_aistroyka, v_memory_id, 'project_default', 'project_default',
    NULL, false, 0.45, 'm13-s05-v1', 1, v_owner
  )
  ON CONFLICT (workspace_id, project_id, memory_id, scope_key) DO UPDATE SET
    importance_delta = EXCLUDED.importance_delta;

  INSERT INTO memory_personalizations (
    workspace_id, project_id, memory_id, scope, scope_key,
    actor_subject_id, pinned, importance_delta, ranking_version, version, updated_by_subject
  ) VALUES (
    v_workspace, v_memory_os, v_memory_id, 'project_default', 'project_default',
    NULL, false, 0.05, 'm13-s05-v1', 1, v_owner
  )
  ON CONFLICT (workspace_id, project_id, memory_id, scope_key) DO UPDATE SET
    importance_delta = EXCLUDED.importance_delta;

  SELECT reason INTO v_reason
  FROM project_routing_corrections
  WHERE memory_id = v_memory_id;
  IF v_reason <> 'legacy_routing_correction_preserved' THEN
    RAISE EXCEPTION 'legacy routing evidence lost';
  END IF;

  v_hits := app.api_search_memories(
    v_secret, v_cursor, 'Legacy upgrade routing memory', v_memory_os, false, NULL, NULL, NULL
  );
  IF coalesce((v_hits->0->'personalization'->>'importanceDelta')::numeric, -1) <> 0.05 THEN
    RAISE EXCEPTION 'legacy_personalization_under_stored_project_ignored expected 0.05';
  END IF;
  IF coalesce((v_hits->0->'personalization'->>'importanceDelta')::numeric, -1) = 0.45 THEN
    RAISE EXCEPTION 'stored-project personalization must not leak after correction';
  END IF;

  PERFORM app.api_apply_project_routing_correction(
    v_secret, v_owner, v_memory_id, v_memory_os,
    'MOVE_TO_MEMORY_OS', 'reapply_p0_blocks_idempotent', '{}'::jsonb
  );
END $$;

SELECT relrowsecurity AS rls_still_enabled_after_upgrade
FROM pg_class
WHERE oid = 'public.project_routing_corrections'::regclass;
\echo expect: rls_still_enabled_after_upgrade = t

\echo p0_migration_upgrade_legacy_cases=pass
