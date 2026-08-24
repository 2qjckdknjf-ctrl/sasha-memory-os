-- P0: Separate Sasha Memory OS project from AISTROYKA; additive routing corrections.

-- ---------------------------------------------------------------------------
-- Projects (idempotent inserts)
-- ---------------------------------------------------------------------------

INSERT INTO projects (id, workspace_id, slug, name, status, aliases)
VALUES (
  '44444444-4444-4444-8444-444444444402',
  '11111111-1111-4111-8111-111111111111',
  'sasha-memory-os',
  'Sasha Memory OS',
  'active',
  ARRAY['sasha-memory-os', 'memory-os', 'memory_os', 'mamoruos']
)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  aliases = EXCLUDED.aliases,
  status = EXCLUDED.status;

INSERT INTO projects (id, workspace_id, slug, name, status, aliases)
VALUES (
  '44444444-4444-4444-8444-444444444403',
  '11111111-1111-4111-8111-111111111111',
  'hiair',
  'HiAir',
  'active',
  ARRAY['hiair', 'hi-air']
)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  aliases = EXCLUDED.aliases,
  status = EXCLUDED.status;

-- Ensure AISTROYKA row keeps correct identity (no rename).
UPDATE projects
SET slug = 'aistroyka', name = 'AISTROYKA', aliases = ARRAY['aistroyka', 'ais']
WHERE id = '44444444-4444-4444-8444-444444444401'
  AND (slug <> 'aistroyka' OR name <> 'AISTROYKA');

-- ---------------------------------------------------------------------------
-- Routing correction ledger (additive; preserves source_events immutability)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS project_routing_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  memory_id uuid NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
  previous_project_id uuid REFERENCES projects(id),
  corrected_project_id uuid NOT NULL REFERENCES projects(id),
  classification text NOT NULL CHECK (
    classification IN (
      'KEEP_AISTROYKA',
      'MOVE_TO_MEMORY_OS',
      'MOVE_TO_HIAIR',
      'UNCLASSIFIED',
      'REVIEW_REQUIRED'
    )
  ),
  reason text NOT NULL,
  source_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_subject_id uuid NOT NULL REFERENCES subjects(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (memory_id)
);

CREATE INDEX IF NOT EXISTS idx_project_routing_corrections_workspace
  ON project_routing_corrections (workspace_id);

CREATE INDEX IF NOT EXISTS idx_project_routing_corrections_corrected
  ON project_routing_corrections (corrected_project_id);

CREATE OR REPLACE FUNCTION app.effective_memory_project_id(p_memory_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT coalesce(
    (
      SELECT prc.corrected_project_id
      FROM project_routing_corrections prc
      WHERE prc.memory_id = p_memory_id
      LIMIT 1
    ),
    (SELECT mr.project_id FROM memory_records mr WHERE mr.id = p_memory_id)
  );
$$;

CREATE OR REPLACE FUNCTION app.api_apply_project_routing_correction(
  p_secret text,
  p_actor_subject_id uuid,
  p_memory_id uuid,
  p_corrected_project_id uuid,
  p_classification text,
  p_reason text,
  p_source_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_memory memory_records%ROWTYPE;
  v_row project_routing_corrections%ROWTYPE;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_actor_subject_id);

  IF NOT EXISTS (
    SELECT 1 FROM workspace_memberships wm
    WHERE wm.workspace_id = (
      SELECT workspace_id FROM memory_records WHERE id = p_memory_id
    )
      AND wm.subject_id = p_actor_subject_id
      AND wm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_memory FROM memory_records WHERE id = p_memory_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'memory not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_classification NOT IN (
    'KEEP_AISTROYKA', 'MOVE_TO_MEMORY_OS', 'MOVE_TO_HIAIR', 'UNCLASSIFIED', 'REVIEW_REQUIRED'
  ) THEN
    RAISE EXCEPTION 'invalid classification';
  END IF;

  INSERT INTO project_routing_corrections (
    workspace_id,
    memory_id,
    previous_project_id,
    corrected_project_id,
    classification,
    reason,
    source_evidence,
    actor_subject_id
  )
  VALUES (
    v_memory.workspace_id,
    p_memory_id,
    v_memory.project_id,
    p_corrected_project_id,
    p_classification,
    nullif(btrim(p_reason), ''),
    coalesce(p_source_evidence, '{}'::jsonb),
    p_actor_subject_id
  )
  ON CONFLICT (memory_id) DO UPDATE SET
    corrected_project_id = EXCLUDED.corrected_project_id,
    classification = EXCLUDED.classification,
    reason = EXCLUDED.reason,
    source_evidence = EXCLUDED.source_evidence,
    actor_subject_id = EXCLUDED.actor_subject_id
  RETURNING * INTO v_row;

  INSERT INTO audit_log (
    workspace_id,
    actor_subject_id,
    action,
    object_type,
    object_id,
    reason,
    before_state,
    after_state
  )
  VALUES (
    v_memory.workspace_id,
    p_actor_subject_id,
    'project_routing.correct',
    'memory',
    p_memory_id,
    p_reason,
    jsonb_build_object('projectId', v_memory.project_id),
    jsonb_build_object(
      'correctedProjectId', p_corrected_project_id,
      'classification', p_classification
    )
  );

  RETURN jsonb_build_object(
    'memoryId', v_row.memory_id,
    'previousProjectId', v_row.previous_project_id,
    'correctedProjectId', v_row.corrected_project_id,
    'classification', v_row.classification
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_apply_project_routing_correction(
  p_secret text,
  p_actor_subject_id uuid,
  p_memory_id uuid,
  p_corrected_project_id uuid,
  p_classification text,
  p_reason text,
  p_source_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_apply_project_routing_correction(
    p_secret, p_actor_subject_id, p_memory_id,
    p_corrected_project_id, p_classification, p_reason, p_source_evidence
  );
$$;

-- ---------------------------------------------------------------------------
-- Sasha Memory OS project_state (additive)
-- ---------------------------------------------------------------------------

INSERT INTO project_state_versions (
  id, workspace_id, project_id, version, state, summary, created_by_subject
)
SELECT
  '77777777-7777-4777-8777-777777777702',
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444402',
  1,
  '{
    "stage": "shared-memory-remediation",
    "completed": ["m6-chatgpt-mode-a"],
    "in_progress": ["shared-memory-e2e"],
    "blocked": ["m15-live-e2e", "chatgpt-cursor-bidirectional"],
    "next": ["p0-project-identity", "p0-acl", "shared-memory-e2e-v1"],
    "risks": ["project_uuid_collision_resolved"],
    "active_decisions": []
  }'::jsonb,
  'Sasha Memory OS canonical project state after P0 identity split',
  '33333333-3333-4333-8333-333333333301'
WHERE NOT EXISTS (
  SELECT 1 FROM project_state_versions
  WHERE project_id = '44444444-4444-4444-8444-444444444402'
);

-- ---------------------------------------------------------------------------
-- ACL: ChatGPT + Cursor scoped to Sasha Memory OS project only
-- ---------------------------------------------------------------------------

INSERT INTO acl_entries (
  workspace_id, subject_id, effect, resource_type, project_id, actions, sensitivity_max
)
SELECT
  '11111111-1111-4111-8111-111111111111',
  s.id,
  'allow',
  t.resource_type,
  '44444444-4444-4444-8444-444444444402',
  t.actions,
  t.sensitivity_max
FROM subjects s
CROSS JOIN (
  VALUES
    ('chatgpt', 'memory', ARRAY['read', 'write']::text[], 'internal'),
    ('chatgpt', 'project', ARRAY['read']::text[], 'internal'),
    ('chatgpt', 'project_state', ARRAY['read']::text[], 'internal'),
    ('cursor', 'memory', ARRAY['read', 'write']::text[], 'internal'),
    ('cursor', 'project', ARRAY['read']::text[], 'internal'),
    ('cursor', 'project_state', ARRAY['read', 'write']::text[], 'internal'),
    ('cursor', 'handoff', ARRAY['read', 'write']::text[], 'internal'),
    ('cursor', 'session', ARRAY['read', 'write']::text[], 'internal')
) AS t(actor_key, resource_type, actions, sensitivity_max)
WHERE s.external_key = t.actor_key
  AND NOT EXISTS (
    SELECT 1 FROM acl_entries a
    WHERE a.workspace_id = '11111111-1111-4111-8111-111111111111'
      AND a.subject_id = s.id
      AND a.effect = 'allow'
      AND a.resource_type = t.resource_type
      AND a.project_id = '44444444-4444-4444-8444-444444444402'
      AND a.actions = t.actions
  );

-- Search: use effective project for scoped queries (routing corrections)
DROP FUNCTION IF EXISTS public.api_search_memories(text, uuid, text, uuid, boolean, jsonb, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS app.api_search_memories(text, uuid, text, uuid, boolean, jsonb, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION app.api_search_memories(
  p_secret text,
  p_subject_id uuid,
  p_query text,
  p_project_id uuid DEFAULT NULL,
  p_include_history boolean DEFAULT false,
  p_query_embedding jsonb DEFAULT NULL,
  p_recorded_after timestamptz DEFAULT NULL,
  p_recorded_before timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_query text := coalesce(p_query, '');
  v_has_query boolean := btrim(v_query) <> '';
  v_query_vec vector(32);
  v_query_vec_hq vector(1536);
  v_qdims int := 0;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_recorded_after IS NOT NULL
     AND p_recorded_before IS NOT NULL
     AND p_recorded_after > p_recorded_before THEN
    RAISE EXCEPTION 'recorded_after must be <= recorded_before';
  END IF;

  IF p_query_embedding IS NOT NULL
     AND jsonb_typeof(p_query_embedding) = 'array' THEN
    v_qdims := jsonb_array_length(p_query_embedding);
    IF v_qdims = 32 THEN
      v_query_vec := (
        SELECT array_agg(value::text::float4 ORDER BY ordinality)::vector(32)
        FROM jsonb_array_elements(p_query_embedding) WITH ORDINALITY AS t(value, ordinality)
      );
    ELSIF v_qdims = 1536 THEN
      v_query_vec_hq := (
        SELECT array_agg(value::text::float4 ORDER BY ordinality)::vector(1536)
        FROM jsonb_array_elements(p_query_embedding) WITH ORDINALITY AS t(value, ordinality)
      );
    END IF;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(hit ORDER BY (hit->>'score')::float8 DESC)
    FROM (
      SELECT jsonb_build_object(
        'memory', to_jsonb(m) || jsonb_build_object(
          'effective_project_id', app.effective_memory_project_id(m.id)
        ),
        'score',
          (m.importance * m.confidence)
          * CASE m.status
              WHEN 'verified' THEN 1.15
              WHEN 'active' THEN 1.08
              WHEN 'candidate' THEN 1.0
              WHEN 'disputed' THEN 0.7
              ELSE 0.5
            END
          * CASE
              WHEN NOT v_has_query THEN 1.0
              WHEN m.title ILIKE '%' || v_query || '%'
                OR m.content ILIKE '%' || v_query || '%' THEN 1.0
              ELSE 0.6
            END
          * CASE
              WHEN v_query_vec_hq IS NOT NULL AND m.embedding_vector_hq IS NOT NULL THEN
                0.7 + 0.3 * greatest(0.0, 1.0 - (m.embedding_vector_hq <=> v_query_vec_hq))
              WHEN v_query_vec IS NOT NULL AND m.embedding_vector IS NOT NULL THEN
                0.7 + 0.3 * greatest(0.0, 1.0 - (m.embedding_vector <=> v_query_vec))
              ELSE 1.0
            END,
        'reason',
          CASE
            WHEN v_query_vec_hq IS NOT NULL AND m.embedding_vector_hq IS NOT NULL
              THEN 'hybrid:sql+vector-hq'
            WHEN v_query_vec IS NOT NULL AND m.embedding_vector IS NOT NULL
              THEN 'hybrid:sql+vector'
            ELSE 'structured+text'
          END
      ) AS hit
      FROM memory_records m
      WHERE (
          p_project_id IS NULL
          OR app.effective_memory_project_id(m.id) = p_project_id
        )
        AND (
          p_include_history
          OR m.status IN ('active', 'verified', 'candidate')
        )
        AND (p_recorded_after IS NULL OR m.recorded_at >= p_recorded_after)
        AND (p_recorded_before IS NULL OR m.recorded_at <= p_recorded_before)
        AND app.has_acl(
          m.workspace_id,
          'memory',
          'read',
          app.effective_memory_project_id(m.id),
          m.sensitivity
        )
        AND (
          NOT v_has_query
          OR m.title ILIKE '%' || v_query || '%'
          OR m.content ILIKE '%' || v_query || '%'
          OR (
            v_query_vec_hq IS NOT NULL
            AND m.embedding_vector_hq IS NOT NULL
            AND (m.embedding_vector_hq <=> v_query_vec_hq) < 0.55
          )
          OR (
            v_query_vec IS NOT NULL
            AND m.embedding_vector IS NOT NULL
            AND (m.embedding_vector <=> v_query_vec) < 0.55
          )
        )
    ) ranked
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_search_memories(
  p_secret text,
  p_subject_id uuid,
  p_query text,
  p_project_id uuid DEFAULT NULL,
  p_include_history boolean DEFAULT false,
  p_query_embedding jsonb DEFAULT NULL,
  p_recorded_after timestamptz DEFAULT NULL,
  p_recorded_before timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_search_memories(
    p_secret, p_subject_id, p_query, p_project_id,
    p_include_history, p_query_embedding, p_recorded_after, p_recorded_before
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_search_memories(
  text, uuid, text, uuid, boolean, jsonb, timestamptz, timestamptz
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_search_memories(
  text, uuid, text, uuid, boolean, jsonb, timestamptz, timestamptz
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION app.effective_memory_project_id(uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_apply_project_routing_correction(
  text, uuid, uuid, uuid, text, text, jsonb
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_apply_project_routing_correction(
  text, uuid, uuid, uuid, text, text, jsonb
) TO anon, authenticated, service_role;
