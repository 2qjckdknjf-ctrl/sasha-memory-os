-- M19 owner governance API and privilege-boundary acceptance.
BEGIN;

DO $$
DECLARE
  v_secret text := (SELECT value FROM app.runtime_config WHERE key = 'api_secret');
  v_workspace uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '33333333-3333-4333-8333-333333333301';
  v_cursor uuid := '33333333-3333-4333-8333-333333333303';
  v_project uuid := '44444444-4444-4444-8444-444444444402';
  v_memory uuid;
  v_job uuid;
  v_overview jsonb;
  v_inbox jsonb;
  v_jobs jsonb;
BEGIN
  IF has_function_privilege(
    'anon',
    'public.api_control_center_overview(text,uuid,uuid,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.api_list_processing_jobs(text,uuid,uuid,text[],integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.api_list_unclassified_memories(text,uuid,uuid,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'M19 public governance RPCs must be service-role only';
  END IF;

  v_overview := app.api_control_center_overview(
    v_secret, v_owner, v_workspace, v_project
  );
  IF v_overview->>'workspaceId' <> v_workspace::text
    OR v_overview->>'projectId' <> v_project::text
    OR v_overview->'freshness'->>'slaSeconds' <> '86400'
    OR NOT (v_overview ? 'jobs')
    OR NOT (v_overview ? 'routing')
  THEN
    RAISE EXCEPTION 'owner overview response is incomplete: %', v_overview;
  END IF;

  BEGIN
    PERFORM app.api_control_center_overview(
      v_secret, v_cursor, v_workspace, v_project
    );
    RAISE EXCEPTION 'non-owner overview must be forbidden';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  SELECT m.id INTO v_memory
  FROM memory_records m
  WHERE m.workspace_id = v_workspace
    AND m.project_id IS NOT NULL
  ORDER BY m.recorded_at DESC
  LIMIT 1;

  IF v_memory IS NULL THEN
    RAISE EXCEPTION 'M19 test requires one seeded memory';
  END IF;

  PERFORM app.api_apply_project_routing_correction(
    v_secret,
    v_owner,
    v_memory,
    v_project,
    'UNCLASSIFIED',
    'M19 owner routing review',
    jsonb_build_object('test', 'm19-s01-v1')
  );

  v_inbox := app.api_list_unclassified_memories(
    v_secret, v_owner, v_workspace, 50
  );
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_inbox->'items') item
    WHERE item->>'memoryId' = v_memory::text
      AND item->>'classification' = 'UNCLASSIFIED'
  ) THEN
    RAISE EXCEPTION 'UNCLASSIFIED inbox omitted routed memory: %', v_inbox;
  END IF;
  IF v_inbox::text LIKE '%content%' THEN
    RAISE EXCEPTION 'UNCLASSIFIED inbox must not expose raw memory content';
  END IF;

  PERFORM app.api_apply_project_routing_correction(
    v_secret,
    v_owner,
    v_memory,
    v_project,
    'MOVE_TO_MEMORY_OS',
    'Owner confirmed Sasha Memory OS project',
    jsonb_build_object('test', 'm19-s01-v1')
  );

  v_inbox := app.api_list_unclassified_memories(
    v_secret, v_owner, v_workspace, 50
  );
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_inbox->'items') item
    WHERE item->>'memoryId' = v_memory::text
  ) THEN
    RAISE EXCEPTION 'resolved routing correction remained in inbox';
  END IF;

  INSERT INTO processing_jobs (
    workspace_id, job_type, status, idempotency_key, attempt, error
  ) VALUES (
    v_workspace,
    'connector_sync',
    'dead_letter',
    'm19-governance-test/' || gen_random_uuid()::text,
    3,
    'bounded synthetic failure'
  ) RETURNING id INTO v_job;

  v_jobs := app.api_list_processing_jobs(
    v_secret, v_owner, v_workspace, ARRAY['dead_letter'], 50
  );
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_jobs->'jobs') job
    WHERE job->>'id' = v_job::text
      AND job->>'status' = 'dead_letter'
  ) THEN
    RAISE EXCEPTION 'dead-letter queue omitted test job: %', v_jobs;
  END IF;
  IF v_jobs::text LIKE '%idempotencyKey%' OR v_jobs::text LIKE '%payload%' THEN
    RAISE EXCEPTION 'job governance response leaked internal payload fields';
  END IF;

  BEGIN
    PERFORM app.api_list_processing_jobs(
      v_secret, v_cursor, v_workspace, ARRAY['dead_letter'], 50
    );
    RAISE EXCEPTION 'non-owner job listing must be forbidden';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
