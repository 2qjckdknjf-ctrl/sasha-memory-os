-- M17 Slice 05: live, project-scoped entity search and bounded graph retrieval.
--
-- These RPCs are the only supported graph read boundary. Browser clients never
-- receive direct table grants, every call binds an explicit subject/project,
-- and traversal cannot exceed the canonical M17 budget.

CREATE OR REPLACE FUNCTION app.can_read_graph_source(
  p_workspace_id uuid,
  p_project_id uuid,
  p_memory_id uuid,
  p_source_event_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, app
AS $$
  SELECT CASE
    WHEN p_memory_id IS NOT NULL THEN EXISTS (
      SELECT 1
      FROM public.memory_records source_memory
      WHERE source_memory.id = p_memory_id
        AND source_memory.workspace_id = p_workspace_id
        AND app.effective_memory_project_id(source_memory.id) = p_project_id
        AND source_memory.status <> 'deleted'
        AND app.has_acl(
          source_memory.workspace_id,
          'memory',
          'read',
          p_project_id,
          source_memory.sensitivity
        )
    )
    WHEN p_source_event_id IS NOT NULL THEN EXISTS (
      SELECT 1
      FROM public.source_events source_event
      WHERE source_event.id = p_source_event_id
        AND source_event.workspace_id = p_workspace_id
        AND source_event.project_id = p_project_id
        AND app.has_acl(
          source_event.workspace_id,
          'memory',
          'read',
          p_project_id,
          source_event.sensitivity
        )
    )
    ELSE app.has_acl(
      p_workspace_id, 'memory', 'read', p_project_id, 'internal'
    )
  END;
$$;

CREATE OR REPLACE FUNCTION app.api_search_entities(
  p_secret text,
  p_subject_id uuid,
  p_project_id uuid,
  p_query text DEFAULT '',
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  v_workspace_id uuid;
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_limit integer := coalesce(p_limit, 20);
  v_entities jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required' USING ERRCODE = '22023';
  END IF;
  IF v_limit < 1 OR v_limit > 50 THEN
    RAISE EXCEPTION 'limit must be between 1 and 50' USING ERRCODE = '22023';
  END IF;

  SELECT p.workspace_id INTO v_workspace_id
  FROM public.projects p
  WHERE p.id = p_project_id;
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT app.has_acl(v_workspace_id, 'memory', 'read', p_project_id, 'internal') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH ranked AS (
    SELECT
      e.*,
      CASE
        WHEN lower(e.canonical_name) = v_query AND v_query <> '' THEN 0
        WHEN EXISTS (
          SELECT 1 FROM public.entity_aliases exact_alias
          WHERE exact_alias.entity_id = e.id
            AND exact_alias.normalized_alias = v_query
            AND app.can_read_graph_source(
              exact_alias.workspace_id,
              e.project_id,
              exact_alias.memory_id,
              exact_alias.source_event_id
            )
        ) AND v_query <> '' THEN 1
        WHEN strpos(lower(e.canonical_name), v_query) = 1 AND v_query <> '' THEN 2
        WHEN EXISTS (
          SELECT 1 FROM public.entity_aliases prefix_alias
          WHERE prefix_alias.entity_id = e.id
            AND strpos(prefix_alias.normalized_alias, v_query) = 1
            AND app.can_read_graph_source(
              prefix_alias.workspace_id,
              e.project_id,
              prefix_alias.memory_id,
              prefix_alias.source_event_id
            )
        ) AND v_query <> '' THEN 3
        ELSE 4
      END AS search_rank
    FROM public.entities e
    WHERE e.workspace_id = v_workspace_id
      AND e.project_id = p_project_id
      AND e.status = 'active'
      AND (e.valid_from IS NULL OR e.valid_from <= now())
      AND (e.valid_to IS NULL OR e.valid_to > now())
      AND app.can_read_graph_source(
        e.workspace_id, e.project_id, e.created_from_memory_id, e.source_event_id
      )
      AND (
        v_query = ''
        OR strpos(lower(e.canonical_name), v_query) > 0
        OR strpos(lower(e.stable_id), v_query) > 0
        OR EXISTS (
          SELECT 1 FROM public.entity_aliases matching_alias
          WHERE matching_alias.entity_id = e.id
            AND strpos(matching_alias.normalized_alias, v_query) > 0
            AND app.can_read_graph_source(
              matching_alias.workspace_id,
              e.project_id,
              matching_alias.memory_id,
              matching_alias.source_event_id
            )
            AND (matching_alias.valid_from IS NULL OR matching_alias.valid_from <= now())
            AND (matching_alias.valid_to IS NULL OR matching_alias.valid_to > now())
        )
      )
    ORDER BY search_rank, e.confidence DESC, e.canonical_name, e.id
    LIMIT v_limit
  )
  SELECT coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'id', ranked.id,
      'projectId', ranked.project_id,
      'stableId', ranked.stable_id,
      'entityClass', ranked.entity_class,
      'canonicalName', ranked.canonical_name,
      'status', ranked.status,
      'confidence', ranked.confidence,
      'sourceRef', ranked.source_ref,
      'sourceEventId', ranked.source_event_id,
      'createdFromMemoryId', ranked.created_from_memory_id,
      'aliases', coalesce(aliases.items, '[]'::jsonb),
      'memoryCount', coalesce(memories.item_count, 0),
      'searchRank', ranked.search_rank
    )) ORDER BY ranked.search_rank, ranked.confidence DESC, ranked.canonical_name, ranked.id
  ), '[]'::jsonb) INTO v_entities
  FROM ranked
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'alias', selected_alias.alias,
      'confidence', selected_alias.confidence,
      'sourceRef', selected_alias.source_ref
    ) ORDER BY selected_alias.confidence DESC, selected_alias.alias) AS items
    FROM (
      SELECT ea.alias, ea.confidence, ea.source_ref
      FROM public.entity_aliases ea
      WHERE ea.entity_id = ranked.id
        AND (ea.valid_from IS NULL OR ea.valid_from <= now())
        AND (ea.valid_to IS NULL OR ea.valid_to > now())
        AND app.can_read_graph_source(
          ea.workspace_id,
          ranked.project_id,
          ea.memory_id,
          ea.source_event_id
        )
      ORDER BY ea.confidence DESC, ea.alias, ea.id
      LIMIT 20
    ) selected_alias
  ) aliases ON true
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT me.memory_id)::integer AS item_count
    FROM public.memory_entities me
    JOIN public.memory_records m ON m.id = me.memory_id
    WHERE me.entity_id = ranked.id
      AND me.project_id = p_project_id
      AND m.status IN ('active', 'verified', 'candidate')
      AND app.effective_memory_project_id(m.id) = p_project_id
      AND app.has_acl(
        m.workspace_id, 'memory', 'read', p_project_id, m.sensitivity
      )
  ) memories ON true;

  RETURN jsonb_build_object(
    'projectId', p_project_id,
    'query', coalesce(p_query, ''),
    'entities', v_entities,
    'count', jsonb_array_length(v_entities),
    'limit', v_limit,
    'backend', 'supabase'
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.api_get_entity_graph(
  p_secret text,
  p_subject_id uuid,
  p_project_id uuid,
  p_entity_id uuid,
  p_max_edges integer DEFAULT 48
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  v_entity public.entities%ROWTYPE;
  v_aliases jsonb;
  v_edges jsonb;
  v_memories jsonb;
  v_max_edges integer := coalesce(p_max_edges, 48);
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'entity_id required' USING ERRCODE = '22023';
  END IF;
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required' USING ERRCODE = '22023';
  END IF;
  IF v_max_edges < 1 OR v_max_edges > 48 THEN
    RAISE EXCEPTION 'max_edges must be between 1 and 48' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_entity
  FROM public.entities e
  WHERE e.id = p_entity_id
    AND e.project_id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entity not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT app.has_acl(
    v_entity.workspace_id, 'memory', 'read', v_entity.project_id, 'internal'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT app.can_read_graph_source(
    v_entity.workspace_id,
    v_entity.project_id,
    v_entity.created_from_memory_id,
    v_entity.source_event_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', ea.id,
    'alias', ea.alias,
    'confidence', ea.confidence,
    'sourceRef', ea.source_ref,
    'sourceEventId', ea.source_event_id,
    'memoryId', ea.memory_id,
    'validFrom', ea.valid_from,
    'validTo', ea.valid_to
  )) ORDER BY ea.confidence DESC, ea.alias, ea.id), '[]'::jsonb)
  INTO v_aliases
  FROM (
    SELECT *
    FROM public.entity_aliases selected_alias
    WHERE selected_alias.entity_id = v_entity.id
      AND (selected_alias.valid_from IS NULL OR selected_alias.valid_from <= now())
      AND (selected_alias.valid_to IS NULL OR selected_alias.valid_to > now())
      AND app.can_read_graph_source(
        selected_alias.workspace_id,
        v_entity.project_id,
        selected_alias.memory_id,
        selected_alias.source_event_id
      )
    ORDER BY selected_alias.confidence DESC, selected_alias.alias, selected_alias.id
    LIMIT 100
  ) ea;

  WITH selected_edges AS (
    SELECT
      ee.*,
      CASE WHEN ee.from_entity_id = v_entity.id THEN 'outbound' ELSE 'inbound' END AS direction,
      CASE WHEN ee.from_entity_id = v_entity.id
        THEN ee.to_entity_id ELSE ee.from_entity_id END AS neighbor_id
    FROM public.entity_edges ee
    WHERE ee.project_id = v_entity.project_id
      AND (ee.from_entity_id = v_entity.id OR ee.to_entity_id = v_entity.id)
      AND (ee.valid_from IS NULL OR ee.valid_from <= now())
      AND (ee.valid_to IS NULL OR ee.valid_to > now())
      AND app.can_read_graph_source(
        ee.workspace_id, ee.project_id, ee.memory_id, ee.source_event_id
      )
    ORDER BY ee.confidence DESC, ee.edge_type, ee.id
    LIMIT v_max_edges
  )
  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', selected_edges.id,
    'direction', selected_edges.direction,
    'edgeType', selected_edges.edge_type,
    'fromEntityId', selected_edges.from_entity_id,
    'toEntityId', selected_edges.to_entity_id,
    'confidence', selected_edges.confidence,
    'sourceRef', selected_edges.source_ref,
    'sourceEventId', selected_edges.source_event_id,
    'memoryId', selected_edges.memory_id,
    'evidence', selected_edges.evidence,
    'validFrom', selected_edges.valid_from,
    'validTo', selected_edges.valid_to,
    'neighbor', jsonb_build_object(
      'id', neighbor.id,
      'stableId', neighbor.stable_id,
      'entityClass', neighbor.entity_class,
      'canonicalName', neighbor.canonical_name,
      'status', neighbor.status,
      'confidence', neighbor.confidence,
      'sourceRef', neighbor.source_ref
    )
  )) ORDER BY selected_edges.confidence DESC, selected_edges.edge_type, selected_edges.id), '[]'::jsonb)
  INTO v_edges
  FROM selected_edges
  JOIN public.entities neighbor ON neighbor.id = selected_edges.neighbor_id
  WHERE neighbor.project_id = v_entity.project_id
    AND app.can_read_graph_source(
      neighbor.workspace_id,
      neighbor.project_id,
      neighbor.created_from_memory_id,
      neighbor.source_event_id
    );

  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', linked.id,
    'title', linked.title,
    'content', linked.content,
    'status', linked.status,
    'memoryType', linked.memory_type,
    'sensitivity', linked.sensitivity,
    'role', linked.role,
    'confidence', linked.link_confidence,
    'sourceRef', linked.link_source_ref,
    'sourceEventId', linked.source_event_id,
    'recordedAt', linked.recorded_at
  )) ORDER BY linked.recorded_at DESC, linked.id), '[]'::jsonb)
  INTO v_memories
  FROM (
    SELECT deduplicated.*
    FROM (
      SELECT DISTINCT ON (m.id)
      m.id, m.title, m.content, m.status, m.memory_type, m.sensitivity,
      me.role, me.confidence AS link_confidence, me.source_ref AS link_source_ref,
      m.source_event_id, m.recorded_at
      FROM public.memory_entities me
      JOIN public.memory_records m ON m.id = me.memory_id
      WHERE me.entity_id = v_entity.id
        AND me.project_id = v_entity.project_id
        AND m.status IN ('active', 'verified', 'candidate')
        AND app.effective_memory_project_id(m.id) = v_entity.project_id
        AND app.has_acl(
          m.workspace_id, 'memory', 'read', v_entity.project_id, m.sensitivity
        )
      ORDER BY m.id, me.confidence DESC, me.role
    ) deduplicated
    ORDER BY deduplicated.recorded_at DESC, deduplicated.id
    LIMIT 50
  ) linked;

  RETURN jsonb_build_object(
    'projectId', v_entity.project_id,
    'entity', jsonb_strip_nulls(jsonb_build_object(
      'id', v_entity.id,
      'workspaceId', v_entity.workspace_id,
      'projectId', v_entity.project_id,
      'stableId', v_entity.stable_id,
      'entityClass', v_entity.entity_class,
      'canonicalName', v_entity.canonical_name,
      'status', v_entity.status,
      'confidence', v_entity.confidence,
      'validFrom', v_entity.valid_from,
      'validTo', v_entity.valid_to,
      'sourceRef', v_entity.source_ref,
      'sourceEventId', v_entity.source_event_id,
      'createdFromMemoryId', v_entity.created_from_memory_id,
      'mergedIntoEntityId', v_entity.merged_into_entity_id,
      'metadata', v_entity.metadata
    )),
    'aliases', v_aliases,
    'edges', v_edges,
    'memories', v_memories,
    'budget', jsonb_build_object('maxEdges', v_max_edges),
    'backend', 'supabase'
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.api_graph_retrieve(
  p_secret text,
  p_subject_id uuid,
  p_project_id uuid,
  p_seed_entity_ids uuid[],
  p_max_hops integer DEFAULT 2,
  p_max_nodes integer DEFAULT 24,
  p_max_edges integer DEFAULT 48,
  p_min_confidence numeric DEFAULT 0.7
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  v_workspace_id uuid;
  v_seed_ids uuid[];
  v_node_ids uuid[];
  v_node_depths integer[];
  v_frontier uuid[];
  v_next_frontier uuid[];
  v_edge_ids uuid[] := ARRAY[]::uuid[];
  v_edge record;
  v_neighbor_id uuid;
  v_depth integer;
  v_valid_seed_count integer;
  v_stop boolean := false;
  v_stopped_reason text := 'complete';
  v_nodes jsonb;
  v_edges jsonb;
  v_memories jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required' USING ERRCODE = '22023';
  END IF;
  IF p_max_hops IS NULL OR p_max_hops < 1 OR p_max_hops > 2 THEN
    RAISE EXCEPTION 'max_hops must be between 1 and 2' USING ERRCODE = '22023';
  END IF;
  IF p_max_nodes IS NULL OR p_max_nodes < 1 OR p_max_nodes > 24 THEN
    RAISE EXCEPTION 'max_nodes must be between 1 and 24' USING ERRCODE = '22023';
  END IF;
  IF p_max_edges IS NULL OR p_max_edges < 1 OR p_max_edges > 48 THEN
    RAISE EXCEPTION 'max_edges must be between 1 and 48' USING ERRCODE = '22023';
  END IF;
  IF p_min_confidence IS NULL OR p_min_confidence < 0.7 OR p_min_confidence > 1 THEN
    RAISE EXCEPTION 'min_confidence must be between 0.7 and 1' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(seed_id ORDER BY seed_id) INTO v_seed_ids
  FROM (
    SELECT DISTINCT seed_id
    FROM unnest(coalesce(p_seed_entity_ids, ARRAY[]::uuid[])) seed_id
    WHERE seed_id IS NOT NULL
  ) seeds;
  IF coalesce(cardinality(v_seed_ids), 0) < 1 THEN
    RAISE EXCEPTION 'at least one seed entity is required' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_seed_ids) > 8 THEN
    RAISE EXCEPTION 'at most 8 seed entities are allowed' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_seed_ids) > p_max_nodes THEN
    RAISE EXCEPTION 'max_nodes must cover every seed entity' USING ERRCODE = '22023';
  END IF;

  SELECT p.workspace_id INTO v_workspace_id
  FROM public.projects p
  WHERE p.id = p_project_id;
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT app.has_acl(v_workspace_id, 'memory', 'read', p_project_id, 'internal') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO v_valid_seed_count
  FROM public.entities e
  WHERE e.id = ANY(v_seed_ids)
    AND e.workspace_id = v_workspace_id
    AND e.project_id = p_project_id
    AND e.status = 'active'
    AND (e.valid_from IS NULL OR e.valid_from <= now())
    AND (e.valid_to IS NULL OR e.valid_to > now())
    AND app.can_read_graph_source(
      e.workspace_id, e.project_id, e.created_from_memory_id, e.source_event_id
    );
  IF v_valid_seed_count <> cardinality(v_seed_ids) THEN
    RAISE EXCEPTION 'seed entity not found in project' USING ERRCODE = 'P0002';
  END IF;

  v_node_ids := v_seed_ids;
  SELECT array_agg(0 ORDER BY ordinality) INTO v_node_depths
  FROM unnest(v_seed_ids) WITH ORDINALITY seeds(seed_id, ordinality);
  v_frontier := v_seed_ids;

  FOR v_depth IN 1..p_max_hops LOOP
    v_next_frontier := ARRAY[]::uuid[];

    FOR v_edge IN
      SELECT
        ee.*,
        CASE
          WHEN ee.from_entity_id = ANY(v_frontier) THEN ee.to_entity_id
          ELSE ee.from_entity_id
        END AS neighbor_id
      FROM public.entity_edges ee
      JOIN public.entities from_entity ON from_entity.id = ee.from_entity_id
      JOIN public.entities to_entity ON to_entity.id = ee.to_entity_id
      WHERE ee.workspace_id = v_workspace_id
        AND ee.project_id = p_project_id
        AND (ee.from_entity_id = ANY(v_frontier) OR ee.to_entity_id = ANY(v_frontier))
        AND NOT ee.id = ANY(v_edge_ids)
        AND ee.confidence >= p_min_confidence
        AND (ee.valid_from IS NULL OR ee.valid_from <= now())
        AND (ee.valid_to IS NULL OR ee.valid_to > now())
        AND (
          ee.source_event_id IS NOT NULL
          OR ee.memory_id IS NOT NULL
          OR ee.evidence <> '{}'::jsonb
        )
        AND from_entity.project_id = p_project_id
        AND to_entity.project_id = p_project_id
        AND from_entity.status = 'active'
        AND to_entity.status = 'active'
        AND app.can_read_graph_source(
          ee.workspace_id, ee.project_id, ee.memory_id, ee.source_event_id
        )
        AND app.can_read_graph_source(
          from_entity.workspace_id,
          from_entity.project_id,
          from_entity.created_from_memory_id,
          from_entity.source_event_id
        )
        AND app.can_read_graph_source(
          to_entity.workspace_id,
          to_entity.project_id,
          to_entity.created_from_memory_id,
          to_entity.source_event_id
        )
      ORDER BY ee.confidence DESC, ee.edge_type, ee.id
      LIMIT greatest(p_max_edges - cardinality(v_edge_ids) + 1, 1)
    LOOP
      v_neighbor_id := v_edge.neighbor_id;

      IF NOT v_neighbor_id = ANY(v_node_ids) AND cardinality(v_node_ids) >= p_max_nodes THEN
        v_stopped_reason := 'max_nodes';
        v_stop := true;
        EXIT;
      END IF;
      IF cardinality(v_edge_ids) >= p_max_edges THEN
        v_stopped_reason := 'max_edges';
        v_stop := true;
        EXIT;
      END IF;

      v_edge_ids := array_append(v_edge_ids, v_edge.id);
      IF NOT v_neighbor_id = ANY(v_node_ids) THEN
        v_node_ids := array_append(v_node_ids, v_neighbor_id);
        v_node_depths := array_append(v_node_depths, v_depth);
        IF NOT v_neighbor_id = ANY(v_next_frontier) THEN
          v_next_frontier := array_append(v_next_frontier, v_neighbor_id);
        END IF;
      END IF;
    END LOOP;

    EXIT WHEN v_stop;
    EXIT WHEN cardinality(v_next_frontier) = 0;
    v_frontier := v_next_frontier;
    IF v_depth = p_max_hops THEN
      v_stopped_reason := 'max_hops';
    END IF;
  END LOOP;

  IF cardinality(v_edge_ids) = 0 AND EXISTS (
    SELECT 1
    FROM public.entity_edges ee
    WHERE ee.project_id = p_project_id
      AND (ee.from_entity_id = ANY(v_seed_ids) OR ee.to_entity_id = ANY(v_seed_ids))
      AND ee.confidence < p_min_confidence
      AND app.can_read_graph_source(
        ee.workspace_id, ee.project_id, ee.memory_id, ee.source_event_id
      )
  ) THEN
    v_stopped_reason := 'low_evidence';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', e.id,
    'stableId', e.stable_id,
    'entityClass', e.entity_class,
    'canonicalName', e.canonical_name,
    'status', e.status,
    'confidence', e.confidence,
    'depth', depth_value.depth,
    'sourceRef', e.source_ref,
    'sourceEventId', e.source_event_id,
    'createdFromMemoryId', e.created_from_memory_id,
    'metadata', e.metadata
  )) ORDER BY depth_value.depth, e.confidence DESC, e.canonical_name, e.id), '[]'::jsonb)
  INTO v_nodes
  FROM unnest(v_node_ids) WITH ORDINALITY traversed(entity_id, ordinality)
  JOIN public.entities e ON e.id = traversed.entity_id
  CROSS JOIN LATERAL (
    SELECT v_node_depths[traversed.ordinality] AS depth
  ) depth_value;

  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', ee.id,
    'fromEntityId', ee.from_entity_id,
    'toEntityId', ee.to_entity_id,
    'edgeType', ee.edge_type,
    'confidence', ee.confidence,
    'sourceRef', ee.source_ref,
    'sourceEventId', ee.source_event_id,
    'memoryId', ee.memory_id,
    'evidence', ee.evidence,
    'validFrom', ee.valid_from,
    'validTo', ee.valid_to
  )) ORDER BY traversed.ordinality), '[]'::jsonb)
  INTO v_edges
  FROM unnest(v_edge_ids) WITH ORDINALITY traversed(edge_id, ordinality)
  JOIN public.entity_edges ee ON ee.id = traversed.edge_id;

  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', ranked.id,
    'title', ranked.title,
    'contentSnippet', left(ranked.content, 500),
    'status', ranked.status,
    'memoryType', ranked.memory_type,
    'recordedAt', ranked.recorded_at,
    'graphScore', ranked.graph_score,
    'entityIds', ranked.entity_ids,
    'evidenceRefs', ranked.evidence_refs
  )) ORDER BY ranked.graph_score DESC, ranked.recorded_at DESC, ranked.id), '[]'::jsonb)
  INTO v_memories
  FROM (
    SELECT
      m.id, m.title, m.content, m.status, m.memory_type, m.recorded_at,
      max(1.0 / (node_depth.depth + 1.0)) AS graph_score,
      jsonb_agg(DISTINCT me.entity_id) AS entity_ids,
      jsonb_agg(DISTINCT me.source_ref) AS evidence_refs
    FROM unnest(v_node_ids) WITH ORDINALITY traversed(entity_id, ordinality)
    CROSS JOIN LATERAL (
      SELECT v_node_depths[traversed.ordinality] AS depth
    ) node_depth
    JOIN public.memory_entities me ON me.entity_id = traversed.entity_id
    JOIN public.memory_records m ON m.id = me.memory_id
    WHERE me.project_id = p_project_id
      AND m.status IN ('active', 'verified', 'candidate')
      AND app.effective_memory_project_id(m.id) = p_project_id
      AND app.has_acl(m.workspace_id, 'memory', 'read', p_project_id, m.sensitivity)
    GROUP BY m.id, m.title, m.content, m.status, m.memory_type, m.recorded_at
    ORDER BY graph_score DESC, m.recorded_at DESC, m.id
    LIMIT 50
  ) ranked;

  RETURN jsonb_build_object(
    'projectId', p_project_id,
    'seedEntityIds', to_jsonb(v_seed_ids),
    'nodes', v_nodes,
    'edges', v_edges,
    'memories', v_memories,
    'budget', jsonb_build_object(
      'maxHops', p_max_hops,
      'maxNodes', p_max_nodes,
      'maxEdges', p_max_edges,
      'minConfidence', p_min_confidence
    ),
    'trace', jsonb_build_object(
      'visitedNodeCount', cardinality(v_node_ids),
      'traversedEdgeCount', cardinality(v_edge_ids),
      'stoppedReason', v_stopped_reason,
      'evidenceRequired', true,
      'packVersion', 'm17-s05-v1'
    ),
    'backend', 'supabase'
  );
END;
$$;

-- PostgREST exposes the public wrappers; the implementation remains in app.
CREATE OR REPLACE FUNCTION public.api_search_entities(
  p_secret text,
  p_subject_id uuid,
  p_project_id uuid,
  p_query text DEFAULT '',
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  SELECT app.api_search_entities(
    p_secret, p_subject_id, p_project_id, p_query, p_limit
  );
$$;

CREATE OR REPLACE FUNCTION public.api_get_entity_graph(
  p_secret text,
  p_subject_id uuid,
  p_project_id uuid,
  p_entity_id uuid,
  p_max_edges integer DEFAULT 48
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  SELECT app.api_get_entity_graph(
    p_secret, p_subject_id, p_project_id, p_entity_id, p_max_edges
  );
$$;

CREATE OR REPLACE FUNCTION public.api_graph_retrieve(
  p_secret text,
  p_subject_id uuid,
  p_project_id uuid,
  p_seed_entity_ids uuid[],
  p_max_hops integer DEFAULT 2,
  p_max_nodes integer DEFAULT 24,
  p_max_edges integer DEFAULT 48,
  p_min_confidence numeric DEFAULT 0.7
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  SELECT app.api_graph_retrieve(
    p_secret, p_subject_id, p_project_id, p_seed_entity_ids,
    p_max_hops, p_max_nodes, p_max_edges, p_min_confidence
  );
$$;

REVOKE ALL ON FUNCTION app.can_read_graph_source(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.api_search_entities(text, uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.api_get_entity_graph(text, uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.api_graph_retrieve(
  text, uuid, uuid, uuid[], integer, integer, integer, numeric
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_search_entities(text, uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_get_entity_graph(text, uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_graph_retrieve(
  text, uuid, uuid, uuid[], integer, integer, integer, numeric
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION app.can_read_graph_source(uuid, uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION app.api_search_entities(text, uuid, uuid, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION app.api_get_entity_graph(text, uuid, uuid, uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION app.api_graph_retrieve(
  text, uuid, uuid, uuid[], integer, integer, integer, numeric
) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_search_entities(text, uuid, uuid, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.api_get_entity_graph(text, uuid, uuid, uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.api_graph_retrieve(
  text, uuid, uuid, uuid[], integer, integer, integer, numeric
) TO service_role;
