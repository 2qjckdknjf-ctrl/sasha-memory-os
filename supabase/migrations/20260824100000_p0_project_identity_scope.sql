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

ALTER TABLE project_routing_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_routing_corrections FORCE ROW LEVEL SECURITY;

-- Defense in depth: no direct REST/Data API access; mutations via owner RPC only.
REVOKE ALL ON TABLE project_routing_corrections FROM PUBLIC, anon, authenticated;

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

-- Revoke legacy Cursor AISTROYKA project grants on upgraded databases.
DELETE FROM acl_entries a
USING subjects s
WHERE a.workspace_id = '11111111-1111-4111-8111-111111111111'
  AND a.subject_id = s.id
  AND s.external_key = 'cursor'
  AND a.effect = 'allow'
  AND a.project_id = '44444444-4444-4444-8444-444444444401'
  AND a.resource_type IN ('memory', 'project', 'project_state', 'handoff', 'session');

-- Remove workspace-wide agent grants that bypass explicit project scope.
DELETE FROM acl_entries a
USING subjects s
WHERE a.workspace_id = '11111111-1111-4111-8111-111111111111'
  AND a.subject_id = s.id
  AND s.external_key IN ('chatgpt', 'cursor')
  AND a.effect = 'allow'
  AND a.project_id IS NULL
  AND a.resource_type IN ('memory', 'handoff');

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
    ('chatgpt', 'handoff', ARRAY['read', 'write']::text[], 'internal'),
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
        'memory', (
          to_jsonb(m) || jsonb_build_object(
            'project_id', effective_project.effective_project_id,
            'stored_project_id', m.project_id,
            'effective_project_id', effective_project.effective_project_id
          )
        ),
        'score',
          (
            LEAST(
              1.0,
              GREATEST(0.0, m.importance + coalesce(pref.importance_delta, 0.0))
            )
            * m.confidence
          )
          * CASE m.status
              WHEN 'verified' THEN 1.15
              WHEN 'active' THEN 1.08
              WHEN 'candidate' THEN 1.0
              WHEN 'disputed' THEN 0.7
              ELSE 0.5
            END
          * CASE
              WHEN pref.pinned THEN 1.75
              ELSE 1.0
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
          END,
        'personalization',
          CASE
            WHEN pref.scope IS NULL THEN NULL
            ELSE jsonb_build_object(
              'memoryId', m.id,
              'projectId', effective_project.effective_project_id,
              'storedProjectId', m.project_id,
              'scope', pref.scope,
              'actorSubjectId', pref.actor_subject_id,
              'pinned', pref.pinned,
              'importanceDelta', coalesce(pref.importance_delta, 0.0),
              'rankingVersion', pref.ranking_version,
              'version', pref.version
            )
          END
      ) AS hit
      FROM memory_records m
      CROSS JOIN LATERAL (
        SELECT app.effective_memory_project_id(m.id) AS effective_project_id
      ) effective_project
      LEFT JOIN LATERAL (
        SELECT
          mp.scope,
          mp.actor_subject_id,
          mp.pinned,
          mp.importance_delta,
          mp.ranking_version,
          mp.version
        FROM memory_personalizations mp
        WHERE mp.workspace_id = m.workspace_id
          AND mp.project_id = effective_project.effective_project_id
          AND mp.memory_id = m.id
          AND (
            (mp.scope = 'actor' AND mp.actor_subject_id = p_subject_id)
            OR mp.scope = 'project_default'
          )
        ORDER BY
          CASE WHEN mp.scope = 'actor' THEN 0 ELSE 1 END,
          mp.version DESC
        LIMIT 1
      ) pref ON true
      WHERE (
          p_project_id IS NULL
          OR effective_project.effective_project_id = p_project_id
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
          effective_project.effective_project_id,
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

-- Align memory.get ACL with search effective-project routing.
CREATE OR REPLACE FUNCTION app.api_get_memory(
  p_secret text,
  p_subject_id uuid,
  p_memory_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_row memory_records%ROWTYPE;
  v_effective_project_id uuid;
  v_source jsonb := NULL;
  v_evidence jsonb := '[]'::jsonb;
  v_provenance jsonb := NULL;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT * INTO v_row
  FROM memory_records
  WHERE id = p_memory_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'memory not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member(v_row.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_effective_project_id := app.effective_memory_project_id(v_row.id);

  IF NOT app.has_acl(
    v_row.workspace_id,
    'memory',
    'read',
    v_effective_project_id,
    v_row.sensitivity
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_strip_nulls(jsonb_build_object(
    'sourceEventId', se.id,
    'provider', se.provider,
    'eventType', se.event_type,
    'observedAt', se.observed_at,
    'recordedAt', se.recorded_at,
    'payload', CASE
      WHEN se.payload ? 'content' THEN se.payload - 'content'
      ELSE se.payload
    END
  )) INTO v_source
  FROM source_events se
  WHERE se.id = v_row.source_event_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'sourceEventId', me.source_event_id,
        'evidenceSpan', me.evidence_span,
        'artifact', CASE
          WHEN a.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', a.id,
            'mimeType', a.mime_type,
            'storageMode', a.storage_mode,
            'storageKey', a.storage_key,
            'checksumSha256', a.checksum_sha256,
            'byteSize', a.byte_size,
            'metadata', CASE
              WHEN a.metadata ? 'text' THEN a.metadata - 'text'
              ELSE a.metadata
            END
          )
        END
      ))
      ORDER BY me.source_event_id
    ),
    '[]'::jsonb
  ) INTO v_evidence
  FROM memory_evidence me
  LEFT JOIN artifacts a
    ON a.source_event_id = me.source_event_id
   AND a.workspace_id = me.workspace_id
  WHERE me.memory_id = v_row.id;

  SELECT jsonb_strip_nulls(jsonb_build_object(
    'origin', CASE
      WHEN v_row.source_event_id IS NULL THEN 'manual'
      ELSE 'source_event'
    END,
    'sourceEventId', v_row.source_event_id,
    'createdBySubject', v_row.created_by_subject,
    'revisionCount', (
      SELECT count(*)::integer
      FROM memory_revisions mr
      WHERE mr.memory_id = v_row.id
    ),
    'decisionRationale', (
      SELECT d.rationale
      FROM decisions d
      WHERE d.memory_id = v_row.id
      LIMIT 1
    ),
    'statusReason', v_row.metadata->>'status_reason'
  )) INTO v_provenance;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'title', v_row.title,
    'content', v_row.content,
    'status', v_row.status,
    'sensitivity', v_row.sensitivity,
    'memoryType', v_row.memory_type,
    'projectId', v_effective_project_id,
    'storedProjectId', v_row.project_id,
    'effectiveProjectId', v_effective_project_id,
    'workspaceId', v_row.workspace_id,
    'recordedAt', v_row.recorded_at,
    'observedAt', v_row.observed_at,
    'validFrom', v_row.valid_from,
    'validTo', v_row.valid_to,
    'sourceEventId', v_row.source_event_id,
    'createdBySubject', v_row.created_by_subject,
    'supersededBy', v_row.superseded_by,
    'importance', v_row.importance,
    'confidence', v_row.confidence,
    'schemaVersion', v_row.schema_version,
    'metadata', v_row.metadata,
    'embedding', v_row.embedding,
    'embeddingEngine', v_row.embedding_engine,
    'embeddingDims', v_row.embedding_dims,
    'source', v_source,
    'evidence', v_evidence,
    'provenance', v_provenance
  );
END;
$$;

-- Personalization: scope reads/writes to effective project after routing correction.
DROP POLICY IF EXISTS memory_personalizations_select ON memory_personalizations;
CREATE POLICY memory_personalizations_select
  ON memory_personalizations
  FOR SELECT
  USING (
    app.is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1
      FROM memory_records mr
      WHERE mr.id = memory_personalizations.memory_id
        AND mr.workspace_id = memory_personalizations.workspace_id
        AND app.effective_memory_project_id(mr.id) = memory_personalizations.project_id
        AND app.has_acl(
          mr.workspace_id,
          'memory',
          'read',
          app.effective_memory_project_id(mr.id),
          mr.sensitivity
        )
    )
    AND (
      scope = 'project_default'
      OR actor_subject_id = app.current_subject_id()
    )
  );

CREATE OR REPLACE FUNCTION app.api_set_memory_personalization(
  p_secret text,
  p_subject_id uuid,
  p_project_id uuid,
  p_memory_id uuid,
  p_scope text DEFAULT 'actor',
  p_reason text DEFAULT NULL,
  p_pinned boolean DEFAULT NULL,
  p_importance_delta double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_memory memory_records%ROWTYPE;
  v_effective_project_id uuid;
  v_existing memory_personalizations%ROWTYPE;
  v_next memory_personalizations%ROWTYPE;
  v_scope text := coalesce(nullif(btrim(p_scope), ''), 'actor');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_scope_key text;
  v_actor_subject_id uuid;
  v_should_clear boolean;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required';
  END IF;
  IF p_memory_id IS NULL THEN
    RAISE EXCEPTION 'memory_id required';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason required';
  END IF;
  IF v_scope NOT IN ('actor', 'project_default') THEN
    RAISE EXCEPTION 'invalid scope: %', v_scope;
  END IF;
  IF p_importance_delta IS NOT NULL
     AND (p_importance_delta < -0.5 OR p_importance_delta > 0.5) THEN
    RAISE EXCEPTION 'importance_delta must be between -0.5 and 0.5';
  END IF;

  SELECT * INTO v_memory
  FROM memory_records
  WHERE id = p_memory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'memory not found' USING ERRCODE = 'P0002';
  END IF;

  v_effective_project_id := app.effective_memory_project_id(v_memory.id);

  IF p_project_id IS DISTINCT FROM v_effective_project_id THEN
    RAISE EXCEPTION 'project mismatch';
  END IF;
  IF NOT app.is_workspace_member(v_memory.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT app.has_acl(
    v_memory.workspace_id,
    'memory',
    'read',
    v_effective_project_id,
    v_memory.sensitivity
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_scope = 'project_default'
     AND NOT EXISTS (
       SELECT 1
       FROM workspace_memberships wm
       WHERE wm.workspace_id = v_memory.workspace_id
         AND wm.subject_id = p_subject_id
         AND wm.role = 'owner'
     ) THEN
    RAISE EXCEPTION 'owner subject required for project-default personalization';
  END IF;

  v_actor_subject_id := CASE WHEN v_scope = 'actor' THEN p_subject_id ELSE NULL END;
  v_scope_key := CASE
    WHEN v_scope = 'actor' THEN p_subject_id::text
    ELSE 'project_default'
  END;
  v_should_clear := coalesce(p_pinned, false) = false AND p_importance_delta IS NULL;

  SELECT * INTO v_existing
  FROM memory_personalizations
  WHERE workspace_id = v_memory.workspace_id
    AND project_id = v_effective_project_id
    AND memory_id = p_memory_id
    AND scope_key = v_scope_key
  FOR UPDATE;

  IF v_should_clear THEN
    DELETE FROM memory_personalizations
    WHERE workspace_id = v_memory.workspace_id
      AND project_id = v_effective_project_id
      AND memory_id = p_memory_id
      AND scope_key = v_scope_key;

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
      p_subject_id,
      'memory.personalization.cleared',
      'memory_personalization',
      coalesce(v_existing.id, v_memory.id),
      v_reason,
      CASE
        WHEN v_existing.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'projectId', v_existing.project_id,
          'storedProjectId', v_memory.project_id,
          'effectiveProjectId', v_effective_project_id,
          'memoryId', v_existing.memory_id,
          'scope', v_existing.scope,
          'actorSubjectId', v_existing.actor_subject_id,
          'pinned', v_existing.pinned,
          'importanceDelta', v_existing.importance_delta,
          'rankingVersion', v_existing.ranking_version,
          'version', v_existing.version
        )
      END,
      jsonb_build_object(
        'projectId', v_effective_project_id,
        'storedProjectId', v_memory.project_id,
        'effectiveProjectId', v_effective_project_id,
        'memoryId', p_memory_id,
        'scope', v_scope,
        'actorSubjectId', v_actor_subject_id,
        'cleared', true,
        'rankingVersion', 'm13-s05-v1'
      )
    );

    RETURN jsonb_build_object(
      'memoryId', p_memory_id,
      'projectId', v_effective_project_id,
      'storedProjectId', v_memory.project_id,
      'effectiveProjectId', v_effective_project_id,
      'scope', v_scope,
      'actorSubjectId', v_actor_subject_id,
      'pinned', false,
      'importanceDelta', NULL,
      'rankingVersion', 'm13-s05-v1',
      'version', NULL,
      'cleared', true
    );
  END IF;

  INSERT INTO memory_personalizations (
    workspace_id,
    project_id,
    memory_id,
    scope,
    scope_key,
    actor_subject_id,
    pinned,
    importance_delta,
    ranking_version,
    version,
    updated_by_subject
  )
  VALUES (
    v_memory.workspace_id,
    v_effective_project_id,
    p_memory_id,
    v_scope,
    v_scope_key,
    v_actor_subject_id,
    coalesce(p_pinned, false),
    p_importance_delta,
    'm13-s05-v1',
    1,
    p_subject_id
  )
  ON CONFLICT (workspace_id, project_id, memory_id, scope_key) DO UPDATE
  SET
    pinned = EXCLUDED.pinned,
    importance_delta = EXCLUDED.importance_delta,
    ranking_version = EXCLUDED.ranking_version,
    version = memory_personalizations.version + 1,
    updated_at = now(),
    updated_by_subject = EXCLUDED.updated_by_subject
  RETURNING * INTO v_next;

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
    p_subject_id,
    'memory.personalization.set',
    'memory_personalization',
    v_next.id,
    v_reason,
    CASE
      WHEN v_existing.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'projectId', v_existing.project_id,
        'storedProjectId', v_memory.project_id,
        'effectiveProjectId', v_effective_project_id,
        'memoryId', v_existing.memory_id,
        'scope', v_existing.scope,
        'actorSubjectId', v_existing.actor_subject_id,
        'pinned', v_existing.pinned,
        'importanceDelta', v_existing.importance_delta,
        'rankingVersion', v_existing.ranking_version,
        'version', v_existing.version
      )
    END,
    jsonb_build_object(
      'projectId', v_next.project_id,
      'storedProjectId', v_memory.project_id,
      'effectiveProjectId', v_effective_project_id,
      'memoryId', v_next.memory_id,
      'scope', v_next.scope,
      'actorSubjectId', v_next.actor_subject_id,
      'pinned', v_next.pinned,
      'importanceDelta', v_next.importance_delta,
      'rankingVersion', v_next.ranking_version,
      'version', v_next.version
    )
  );

  RETURN jsonb_build_object(
    'memoryId', v_next.memory_id,
    'projectId', v_next.project_id,
    'storedProjectId', v_memory.project_id,
    'effectiveProjectId', v_effective_project_id,
    'scope', v_next.scope,
    'actorSubjectId', v_next.actor_subject_id,
    'pinned', v_next.pinned,
    'importanceDelta', v_next.importance_delta,
    'rankingVersion', v_next.ranking_version,
    'version', v_next.version,
    'cleared', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_set_memory_personalization(
  p_secret text,
  p_subject_id uuid,
  p_project_id uuid,
  p_memory_id uuid,
  p_scope text DEFAULT 'actor',
  p_reason text DEFAULT NULL,
  p_pinned boolean DEFAULT NULL,
  p_importance_delta double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_set_memory_personalization(
    p_secret,
    p_subject_id,
    p_project_id,
    p_memory_id,
    p_scope,
    p_reason,
    p_pinned,
    p_importance_delta
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_set_memory_personalization(
  text, uuid, uuid, uuid, text, text, boolean, double precision
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_set_memory_personalization(
  text, uuid, uuid, uuid, text, text, boolean, double precision
) TO anon, authenticated, service_role;

-- List/export uses effective project for filter, ACL, and response payload.
DROP FUNCTION IF EXISTS public.api_list_memories(
  text, uuid, uuid, uuid, text, integer, timestamptz, timestamptz
);
DROP FUNCTION IF EXISTS app.api_list_memories(
  text, uuid, uuid, uuid, text, integer, timestamptz, timestamptz
);

CREATE OR REPLACE FUNCTION app.api_list_memories(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_recorded_after timestamptz DEFAULT NULL,
  p_recorded_before timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500));
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_status IS NOT NULL AND btrim(p_status) <> '' AND p_status NOT IN (
    'candidate', 'active', 'verified', 'disputed', 'superseded', 'retracted', 'deleted'
  ) THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  IF p_recorded_after IS NOT NULL
     AND p_recorded_before IS NOT NULL
     AND p_recorded_after > p_recorded_before THEN
    RAISE EXCEPTION 'recorded_after must be <= recorded_before';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', m.id,
      'title', m.title,
      'content', left(m.content, 500),
      'status', m.status,
      'sensitivity', m.sensitivity,
      'memoryType', m.memory_type,
      'projectId', m.effective_project_id,
      'storedProjectId', m.project_id,
      'effectiveProjectId', m.effective_project_id,
      'recordedAt', m.recorded_at,
      'metadata', m.metadata,
      'embedding', m.embedding,
      'embeddingEngine', m.embedding_engine,
      'embeddingDims', m.embedding_dims
    ) ORDER BY m.recorded_at DESC)
    FROM (
      SELECT m.*, effective_project.effective_project_id
      FROM memory_records m
      CROSS JOIN LATERAL (
        SELECT app.effective_memory_project_id(m.id) AS effective_project_id
      ) effective_project
      WHERE m.workspace_id = p_workspace_id
        AND (
          p_project_id IS NULL
          OR effective_project.effective_project_id = p_project_id
        )
        AND (p_status IS NULL OR btrim(p_status) = '' OR m.status = p_status)
        AND (p_recorded_after IS NULL OR m.recorded_at >= p_recorded_after)
        AND (p_recorded_before IS NULL OR m.recorded_at <= p_recorded_before)
        AND app.has_acl(
          m.workspace_id,
          'memory',
          'read',
          effective_project.effective_project_id,
          m.sensitivity
        )
      ORDER BY m.recorded_at DESC
      LIMIT v_limit
    ) m
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_list_memories(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_recorded_after timestamptz DEFAULT NULL,
  p_recorded_before timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_list_memories(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_project_id,
    p_status,
    p_limit,
    p_recorded_after,
    p_recorded_before
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_list_memories(
  text, uuid, uuid, uuid, text, integer, timestamptz, timestamptz
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_list_memories(
  text, uuid, uuid, uuid, text, integer, timestamptz, timestamptz
) TO anon, authenticated, service_role;

-- Project context must include memories whose effective project matches after routing correction.
CREATE OR REPLACE FUNCTION app.api_project_context(
  p_secret text,
  p_subject_id uuid,
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.has_acl(
    (SELECT workspace_id FROM projects WHERE id = p_project_id),
    'memory',
    'read',
    p_project_id,
    'internal'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'projectId', p_project_id,
    'decisions', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(m) || jsonb_build_object(
          'effectiveProjectId', app.effective_memory_project_id(m.id)
        )
        ORDER BY m.recorded_at DESC
      )
      FROM memory_records m
      WHERE app.effective_memory_project_id(m.id) = p_project_id
        AND m.memory_type = 'decision'
        AND m.status IN ('active', 'verified')
        AND app.has_acl(
          m.workspace_id,
          'memory',
          'read',
          app.effective_memory_project_id(m.id),
          m.sensitivity
        )
    ), '[]'::jsonb),
    'tasks', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(m) || jsonb_build_object(
          'effectiveProjectId', app.effective_memory_project_id(m.id)
        )
        ORDER BY m.recorded_at DESC
      )
      FROM memory_records m
      WHERE app.effective_memory_project_id(m.id) = p_project_id
        AND m.memory_type = 'task'
        AND m.status IN ('active', 'verified')
        AND app.has_acl(
          m.workspace_id,
          'memory',
          'read',
          app.effective_memory_project_id(m.id),
          m.sensitivity
        )
    ), '[]'::jsonb),
    'facts', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(m) || jsonb_build_object(
          'effectiveProjectId', app.effective_memory_project_id(m.id)
        )
        ORDER BY m.recorded_at DESC
      )
      FROM memory_records m
      WHERE app.effective_memory_project_id(m.id) = p_project_id
        AND m.memory_type = 'fact'
        AND m.status IN ('active', 'verified')
        AND app.has_acl(
          m.workspace_id,
          'memory',
          'read',
          app.effective_memory_project_id(m.id),
          m.sensitivity
        )
    ), '[]'::jsonb),
    'state', (
      SELECT to_jsonb(s)
      FROM project_state_versions s
      WHERE s.project_id = p_project_id
      ORDER BY s.version DESC
      LIMIT 1
    ),
    'latestHandoff', (
      SELECT to_jsonb(h)
      FROM handoffs h
      WHERE h.project_id = p_project_id
      ORDER BY h.created_at DESC
      LIMIT 1
    )
  ) INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.api_project_context(
  p_secret text,
  p_subject_id uuid,
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_project_context(p_secret, p_subject_id, p_project_id);
$$;

GRANT EXECUTE ON FUNCTION app.api_project_context(text, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_project_context(text, uuid, uuid)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION app.effective_memory_project_id(uuid)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION app.api_apply_project_routing_correction(
  text, uuid, uuid, uuid, text, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_apply_project_routing_correction(
  text, uuid, uuid, uuid, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.api_apply_project_routing_correction(
  text, uuid, uuid, uuid, text, text, jsonb
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_apply_project_routing_correction(
  text, uuid, uuid, uuid, text, text, jsonb
) TO anon, authenticated, service_role;
