-- Effective-project personalization regression (ephemeral Supabase).
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_memory_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01';
  v_aistroyka uuid := '44444444-4444-4444-8444-444444444401';
  v_memory_os uuid := '44444444-4444-4444-8444-444444444402';
  v_workspace uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '33333333-3333-4333-8333-333333333301';
  v_cursor uuid := '33333333-3333-4333-8333-333333333303';
  v_secret text;
  v_hits jsonb;
  v_hit jsonb;
  v_score numeric;
  v_set jsonb;
BEGIN
  SELECT value INTO v_secret FROM app.runtime_config WHERE key = 'api_secret';

  INSERT INTO memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    sensitivity, importance, confidence, schema_version, recorded_at, observed_at
  ) VALUES (
    v_memory_id, v_workspace, v_aistroyka, 'decision',
    'Effective personalization routing test',
    'Memory physically stored in AISTROYKA', 'active', 'internal',
    0.5, 1.0, 1, now(), now()
  )
  ON CONFLICT (id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    importance = 0.5,
    content = EXCLUDED.content;

  -- Legacy personalization under stored AISTROYKA project (must be ignored after correction).
  INSERT INTO memory_personalizations (
    workspace_id, project_id, memory_id, scope, scope_key,
    actor_subject_id, pinned, importance_delta, ranking_version, version, updated_by_subject
  ) VALUES (
    v_workspace, v_aistroyka, v_memory_id, 'project_default', 'project_default',
    NULL, false, 0.4, 'm13-s05-v1', 1, v_owner
  )
  ON CONFLICT (workspace_id, project_id, memory_id, scope_key) DO UPDATE SET
    importance_delta = EXCLUDED.importance_delta,
    version = memory_personalizations.version + 1;

  PERFORM app.api_apply_project_routing_correction(
    v_secret, v_owner, v_memory_id, v_memory_os,
    'MOVE_TO_MEMORY_OS', 'move for effective personalization test', '{}'::jsonb
  );

  INSERT INTO memory_personalizations (
    workspace_id, project_id, memory_id, scope, scope_key,
    actor_subject_id, pinned, importance_delta, ranking_version, version, updated_by_subject
  ) VALUES (
    v_workspace, v_memory_os, v_memory_id, 'project_default', 'project_default',
    NULL, false, 0.2, 'm13-s05-v1', 1, v_owner
  )
  ON CONFLICT (workspace_id, project_id, memory_id, scope_key) DO UPDATE SET
    importance_delta = EXCLUDED.importance_delta,
    version = memory_personalizations.version + 1;

  v_hits := app.api_search_memories(
    v_secret, v_cursor, 'Effective personalization routing test', v_memory_os, false, NULL, NULL, NULL
  );
  IF jsonb_array_length(v_hits) < 1 THEN
    RAISE EXCEPTION 'expected memory in Memory OS search';
  END IF;
  v_hit := v_hits->0;
  v_score := (v_hit->>'score')::numeric;
  IF coalesce((v_hit->'personalization'->>'importanceDelta')::numeric, 0) <> 0.2 THEN
    RAISE EXCEPTION 'memory_os_project_default_applies expected delta 0.2 got %',
      v_hit->'personalization'->>'importanceDelta';
  END IF;
  IF coalesce((v_hit->'personalization'->>'importanceDelta')::numeric, 0) = 0.4 THEN
    RAISE EXCEPTION 'aistroyka_project_default_ignored_after_correction';
  END IF;

  PERFORM app.api_set_memory_personalization(
    v_secret, v_cursor, v_memory_os, v_memory_id, 'actor',
    'cursor set via effective project', true, 0.1
  );

  BEGIN
    PERFORM app.api_set_memory_personalization(
      v_secret, v_cursor, v_aistroyka, v_memory_id, 'actor',
      'cursor set via stored aistroyka forbidden', true, NULL
    );
    RAISE EXCEPTION 'cursor_set_via_stored_aistroyka_forbidden';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%project mismatch%' AND SQLERRM NOT LIKE '%forbidden%' THEN
        RAISE;
      END IF;
  END;

  v_hits := app.api_search_memories(
    v_secret, v_cursor, 'Effective personalization routing test', v_memory_os, false, NULL, NULL, NULL
  );
  v_hit := v_hits->0;
  IF coalesce((v_hit->'personalization'->>'pinned')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'cursor_actor_pref_beats_project_default expected pinned true';
  END IF;
  IF (v_hit->'personalization'->>'projectId')::uuid <> v_memory_os THEN
    RAISE EXCEPTION 'personalization payload must expose effective projectId';
  END IF;
  IF (v_hit->'personalization'->>'storedProjectId')::uuid <> v_aistroyka THEN
    RAISE EXCEPTION 'personalization payload must preserve storedProjectId';
  END IF;

  v_set := app.api_set_memory_personalization(
    v_secret, v_cursor, v_memory_os, v_memory_id, 'actor',
    'cursor set via effective project readback', true, 0.05
  );
  IF (v_set->>'effectiveProjectId')::uuid <> v_memory_os THEN
    RAISE EXCEPTION 'setter response must return effectiveProjectId';
  END IF;
  IF (v_set->>'storedProjectId')::uuid <> v_aistroyka THEN
    RAISE EXCEPTION 'setter response must return storedProjectId';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      app.api_project_context(v_secret, v_cursor, v_memory_os)->'decisions'
    ) AS d(value)
    WHERE (value->>'id')::uuid = v_memory_id
  ) THEN
    RAISE EXCEPTION 'project_context_includes_effective_routed_memory';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      app.api_list_memories(
        v_secret, v_cursor, v_workspace, v_memory_os, NULL, 50, NULL, NULL
      )
    ) AS row(value)
    WHERE (value->>'id')::uuid = v_memory_id
      AND (value->>'effectiveProjectId')::uuid = v_memory_os
      AND (value->>'storedProjectId')::uuid = v_aistroyka
  ) THEN
    RAISE EXCEPTION 'list_memories_includes_effective_routed_memory';
  END IF;
END $$;

-- Uncorrected memory keeps M13 behavior (stored project personalization applies).
DO $$
DECLARE
  v_memory_id uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
  v_aistroyka uuid := '44444444-4444-4444-8444-444444444401';
  v_workspace uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '33333333-3333-4333-8333-333333333301';
  v_chatgpt uuid := '33333333-3333-4333-8333-333333333302';
  v_secret text;
  v_hits jsonb;
  v_hit jsonb;
BEGIN
  SELECT value INTO v_secret FROM app.runtime_config WHERE key = 'api_secret';

  INSERT INTO memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    sensitivity, importance, confidence, schema_version, recorded_at, observed_at
  ) VALUES (
    v_memory_id, v_workspace, v_aistroyka, 'decision',
    'Uncorrected M13 personalization',
    'No routing correction applied', 'active', 'internal',
    0.5, 1.0, 1, now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO memory_personalizations (
    workspace_id, project_id, memory_id, scope, scope_key,
    actor_subject_id, pinned, importance_delta, ranking_version, version, updated_by_subject
  ) VALUES (
    v_workspace, v_aistroyka, v_memory_id, 'project_default', 'project_default',
    NULL, false, 0.15, 'm13-s05-v1', 1, v_owner
  )
  ON CONFLICT (workspace_id, project_id, memory_id, scope_key) DO UPDATE SET
    importance_delta = EXCLUDED.importance_delta;

  v_hits := app.api_search_memories(
    v_secret, v_chatgpt, 'Uncorrected M13 personalization', v_aistroyka, false, NULL, NULL, NULL
  );
  IF jsonb_array_length(v_hits) < 1 THEN
    RAISE EXCEPTION 'expected uncorrected memory in search';
  END IF;
  v_hit := v_hits->0;
  IF coalesce((v_hit->'personalization'->>'importanceDelta')::numeric, 0) <> 0.15 THEN
    RAISE EXCEPTION 'uncorrected_memory_keeps_m13_behavior expected delta 0.15';
  END IF;
END $$;

\echo p0_effective_project_personalization_cases=pass
