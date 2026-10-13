-- M17.5 live graph boundary: scoped search, inspector and bounded traversal.
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_workspace constant uuid := '11111111-1111-4111-8111-111111111111';
  v_project constant uuid := '44444444-4444-4444-8444-444444444402';
  v_other_project constant uuid := '44444444-4444-4444-8444-444444444401';
  v_owner constant uuid := '33333333-3333-4333-8333-333333333301';
  v_cursor constant uuid := '33333333-3333-4333-8333-333333333303';
  v_memory constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee41';
  v_private_event constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee45';
  v_private_memory constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee46';
  v_entity uuid;
  v_private_entity uuid;
  v_project_entity uuid;
  v_foreign_entity uuid;
  v_search jsonb;
  v_detail jsonb;
  v_graph jsonb;
  v_rejected boolean;
BEGIN
  INSERT INTO public.source_events (
    id, workspace_id, project_id, provider, event_type, idempotency_key,
    observed_at, schema_version, sensitivity, storage_mode, payload,
    created_by_subject
  ) VALUES (
    v_private_event, v_workspace, v_project, 'manual', 'm17.private.case',
    'm17-s05-private-live-db-case', now(), '1.1', 'personal', 'reference',
    '{"title":"M17.5 private graph sentinel"}'::jsonb, v_owner
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    confidence, sensitivity, source_event_id, created_by_subject,
    schema_version, valid_from, observed_at
  ) VALUES (
    v_private_memory, v_workspace, v_project, 'decision',
    'M17.5 private graph sentinel', 'Must stay invisible to internal-only agents.',
    'verified', 1, 'personal', v_private_event, v_owner, '1.0', now(), now()
  ) ON CONFLICT (id) DO NOTHING;

  PERFORM app.api_backfill_entity_graph(v_project);

  SELECT id INTO STRICT v_entity
  FROM public.entities
  WHERE project_id = v_project
    AND stable_id = 'entity:decision:memory:' || v_memory::text;

  SELECT id INTO STRICT v_private_entity
  FROM public.entities
  WHERE project_id = v_project
    AND stable_id = 'entity:decision:memory:' || v_private_memory::text;

  SELECT id INTO STRICT v_project_entity
  FROM public.entities
  WHERE project_id = v_project
    AND stable_id = 'entity:project:memory-os-project:' || v_project::text;

  SELECT id INTO STRICT v_foreign_entity
  FROM public.entities
  WHERE project_id = v_other_project
    AND stable_id = 'entity:project:memory-os-project:' || v_other_project::text;

  v_search := app.api_search_entities(
    'ci-ephemeral-secret', v_owner, v_project,
    'M17.4 stable decision entity', 20
  );

  IF v_search->>'projectId' <> v_project::text
     OR (v_search->>'count')::integer <> 1
     OR v_search->'entities'->0->>'id' <> v_entity::text
     OR v_search->'entities'->0->>'canonicalName' <> 'M17.4 stable decision entity'
     OR v_search->'entities'->0->>'memoryCount' <> '1' THEN
    RAISE EXCEPTION 'entity search returned an unexpected result: %', v_search;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_search->'entities') item
    WHERE item->>'projectId' <> v_project::text
  ) THEN
    RAISE EXCEPTION 'entity search leaked another project';
  END IF;

  v_detail := app.api_get_entity_graph(
    'ci-ephemeral-secret', v_owner, v_project, v_entity, 48
  );

  IF v_detail->'entity'->>'id' <> v_entity::text
     OR v_detail->'entity'->>'projectId' <> v_project::text
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_detail->'aliases') item
       WHERE item->>'memoryId' = v_memory::text
         AND item->>'sourceEventId' = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee40'
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_detail->'edges') item
       WHERE item->>'edgeType' = 'belongs_to'
         AND item->>'toEntityId' = v_project_entity::text
         AND item->>'memoryId' = v_memory::text
         AND btrim(item->>'sourceRef') <> ''
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_detail->'memories') item
       WHERE item->>'id' = v_memory::text
         AND item->>'sourceEventId' = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee40'
     ) THEN
    RAISE EXCEPTION 'entity inspector lost aliases, edge evidence or memory: %', v_detail;
  END IF;

  v_graph := app.api_graph_retrieve(
    'ci-ephemeral-secret', v_owner, v_project, ARRAY[v_entity],
    2, 24, 48, 0.7
  );

  IF (v_graph->'trace'->>'visitedNodeCount')::integer < 2
     OR (v_graph->'trace'->>'visitedNodeCount')::integer > 24
     OR (v_graph->'trace'->>'traversedEdgeCount')::integer < 1
     OR (v_graph->'trace'->>'traversedEdgeCount')::integer > 48
     OR v_graph->'trace'->>'packVersion' <> 'm17-s05-v1'
     OR v_graph->'trace'->>'evidenceRequired' <> 'true'
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_graph->'nodes') item
       WHERE item->>'id' = v_project_entity::text
         AND (item->>'depth')::integer = 1
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_graph->'edges') item
       WHERE item->>'fromEntityId' = v_entity::text
         AND item->>'toEntityId' = v_project_entity::text
         AND btrim(item->>'sourceRef') <> ''
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_graph->'memories') item
       WHERE item->>'id' = v_memory::text
         AND jsonb_array_length(item->'evidenceRefs') > 0
     ) THEN
    RAISE EXCEPTION 'bounded graph retrieval failed: %', v_graph;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_graph->'nodes') item
    JOIN public.entities e ON e.id = (item->>'id')::uuid
    WHERE e.project_id <> v_project
  ) THEN
    RAISE EXCEPTION 'graph traversal crossed project boundary';
  END IF;

  v_search := app.api_search_entities(
    'ci-ephemeral-secret', v_cursor, v_project,
    'M17.5 private graph sentinel', 20
  );
  IF (v_search->>'count')::integer <> 0 THEN
    RAISE EXCEPTION 'sensitivity-limited actor saw private graph entity: %', v_search;
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM app.api_get_entity_graph(
      'ci-ephemeral-secret', v_cursor, v_project, v_private_entity, 48
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'sensitivity-limited actor inspected private graph entity';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM app.api_get_entity_graph(
      'ci-ephemeral-secret', v_owner, v_other_project, v_entity, 48
    );
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'entity inspector ignored the explicit project';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM app.api_graph_retrieve(
      'ci-ephemeral-secret', v_owner, v_project, ARRAY[v_entity],
      3, 24, 48, 0.7
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'over-budget max_hops was accepted';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM app.api_graph_retrieve(
      'ci-ephemeral-secret', v_owner, v_project, ARRAY[v_foreign_entity],
      2, 24, 48, 0.7
    );
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'foreign-project seed was accepted';
  END IF;

  IF has_function_privilege(
    'anon', 'app.can_read_graph_source(uuid,uuid,uuid,uuid)', 'EXECUTE'
  ) OR has_function_privilege(
    'authenticated', 'app.can_read_graph_source(uuid,uuid,uuid,uuid)', 'EXECUTE'
  ) OR has_function_privilege(
    'anon', 'public.api_search_entities(text,uuid,uuid,text,integer)', 'EXECUTE'
  ) OR has_function_privilege(
    'authenticated', 'public.api_search_entities(text,uuid,uuid,text,integer)', 'EXECUTE'
  ) OR has_function_privilege(
    'anon', 'public.api_get_entity_graph(text,uuid,uuid,uuid,integer)', 'EXECUTE'
  ) OR has_function_privilege(
    'authenticated', 'public.api_get_entity_graph(text,uuid,uuid,uuid,integer)', 'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.api_graph_retrieve(text,uuid,uuid,uuid[],integer,integer,integer,numeric)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.api_graph_retrieve(text,uuid,uuid,uuid[],integer,integer,integer,numeric)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'untrusted database roles can execute graph RPCs';
  END IF;
END;
$$;

SELECT 'm17_slice_05_live_graph_cases=pass' AS result;
