-- M17.4 live database contract: additive graph, provenance and idempotency.
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_workspace constant uuid := '11111111-1111-4111-8111-111111111111';
  v_project constant uuid := '44444444-4444-4444-8444-444444444402';
  v_owner constant uuid := '33333333-3333-4333-8333-333333333301';
  v_event constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee40';
  v_memory constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee41';
  v_deleted constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee42';
  v_entity uuid;
  v_source_event uuid;
  v_counts_before jsonb;
  v_counts_after jsonb;
  v_report jsonb;
BEGIN
  INSERT INTO public.source_events (
    id, workspace_id, project_id, provider, event_type, idempotency_key,
    observed_at, schema_version, sensitivity, storage_mode, payload,
    created_by_subject
  ) VALUES (
    v_event, v_workspace, v_project, 'manual', 'm17.backfill.case',
    'm17-s04-live-db-case', now(), '1.1', 'internal', 'reference',
    '{"title":"M17.4 database case"}'::jsonb, v_owner
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    confidence, sensitivity, source_event_id, created_by_subject,
    schema_version, valid_from, observed_at
  ) VALUES (
    v_memory, v_workspace, v_project, 'decision',
    'M17.4 stable decision entity', 'Database contract evidence', 'verified',
    1, 'internal', v_event, v_owner, '1.0', now(), now()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    confidence, sensitivity, created_by_subject, schema_version
  ) VALUES (
    v_deleted, v_workspace, v_project, 'decision',
    'M17.4 deleted decision', 'Must not enter the active graph', 'deleted',
    1, 'internal', v_owner, '1.0'
  ) ON CONFLICT (id) DO NOTHING;

  v_report := app.api_backfill_entity_graph(v_project);

  SELECT id, source_event_id INTO v_entity, v_source_event
  FROM public.memory_records
  WHERE id = v_memory;
  IF v_entity <> v_memory OR v_source_event <> v_event THEN
    RAISE EXCEPTION 'backfill changed canonical memory/source identifiers';
  END IF;

  SELECT id INTO v_entity
  FROM public.entities
  WHERE workspace_id = v_workspace
    AND stable_id = 'entity:decision:memory:' || v_memory::text;
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'decision entity was not backfilled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.entity_aliases
    WHERE entity_id = v_entity
      AND normalized_alias = 'm17.4 stable decision entity'
      AND memory_id = v_memory
      AND source_event_id = v_event
  ) THEN
    RAISE EXCEPTION 'entity alias lost memory/source provenance';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.memory_entities
    WHERE memory_id = v_memory
      AND entity_id = v_entity
      AND role = 'subject'
      AND project_id = v_project
  ) THEN
    RAISE EXCEPTION 'decision memory/entity subject link missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.memory_entities me
    JOIN public.entities e ON e.id = me.entity_id
    WHERE me.memory_id = v_memory
      AND me.role = 'project_context'
      AND me.project_id = v_project
      AND e.stable_id = 'entity:project:memory-os-project:' || v_project::text
  ) THEN
    RAISE EXCEPTION 'project-context coverage missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.entity_edges ee
    WHERE ee.from_entity_id = v_entity
      AND ee.edge_type = 'belongs_to'
      AND ee.memory_id = v_memory
      AND ee.source_event_id = v_event
      AND ee.evidence <> '{}'::jsonb
  ) THEN
    RAISE EXCEPTION 'typed edge is not traceable to evidence';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.entities WHERE created_from_memory_id = v_deleted
  ) OR EXISTS (
    SELECT 1 FROM public.memory_entities WHERE memory_id = v_deleted
  ) THEN
    RAISE EXCEPTION 'deleted memory leaked into entity graph';
  END IF;

  IF coalesce((v_report->>'eligibleMemories')::integer, 0)
     <> coalesce((v_report->>'projectContextLinks')::integer, -1) THEN
    RAISE EXCEPTION 'project-context coverage is incomplete: %', v_report;
  END IF;

  SELECT jsonb_build_object(
    'entities', count(*) FILTER (WHERE kind = 'entity'),
    'aliases', count(*) FILTER (WHERE kind = 'alias'),
    'edges', count(*) FILTER (WHERE kind = 'edge'),
    'links', count(*) FILTER (WHERE kind = 'link')
  ) INTO v_counts_before
  FROM (
    SELECT 'entity' AS kind FROM public.entities
    UNION ALL SELECT 'alias' FROM public.entity_aliases
    UNION ALL SELECT 'edge' FROM public.entity_edges
    UNION ALL SELECT 'link' FROM public.memory_entities
  ) rows;

  PERFORM app.api_backfill_entity_graph(v_project);

  SELECT jsonb_build_object(
    'entities', count(*) FILTER (WHERE kind = 'entity'),
    'aliases', count(*) FILTER (WHERE kind = 'alias'),
    'edges', count(*) FILTER (WHERE kind = 'edge'),
    'links', count(*) FILTER (WHERE kind = 'link')
  ) INTO v_counts_after
  FROM (
    SELECT 'entity' AS kind FROM public.entities
    UNION ALL SELECT 'alias' FROM public.entity_aliases
    UNION ALL SELECT 'edge' FROM public.entity_edges
    UNION ALL SELECT 'link' FROM public.memory_entities
  ) rows;

  IF v_counts_before <> v_counts_after THEN
    RAISE EXCEPTION 'backfill is not idempotent: before %, after %',
      v_counts_before, v_counts_after;
  END IF;

  -- The preceding P0 upgrade case stores this memory under AISTROYKA but
  -- routes it effectively to Memory OS. M17.4 must follow effective routing.
  IF EXISTS (
    SELECT 1
    FROM public.memory_entities
    WHERE memory_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01'
      AND role = 'project_context'
      AND project_id <> v_project
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.memory_entities
    WHERE memory_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01'
      AND role = 'project_context'
      AND project_id = v_project
  ) THEN
    RAISE EXCEPTION 'backfill ignored effective project routing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.entities'::regclass
      AND relrowsecurity AND relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.entity_aliases'::regclass
      AND relrowsecurity AND relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.entity_edges'::regclass
      AND relrowsecurity AND relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.memory_entities'::regclass
      AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'entity graph RLS is not forced';
  END IF;

  IF has_table_privilege('anon', 'public.entities', 'SELECT')
     OR has_table_privilege('authenticated', 'public.entities', 'SELECT')
     OR has_function_privilege('anon', 'app.api_backfill_entity_graph(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'app.api_backfill_entity_graph(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'entity graph leaked direct client grants';
  END IF;
END $$;

\echo m17_slice_04_entity_graph_cases=pass
