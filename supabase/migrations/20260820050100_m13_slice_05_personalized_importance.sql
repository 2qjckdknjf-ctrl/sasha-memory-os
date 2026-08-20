-- M13 Slice 05: project-scoped personalized importance and pinning.

CREATE TABLE memory_personalizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  memory_id uuid NOT NULL REFERENCES memory_records (id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('actor', 'project_default')),
  scope_key text NOT NULL,
  actor_subject_id uuid REFERENCES subjects (id) ON DELETE CASCADE,
  pinned boolean NOT NULL DEFAULT false,
  importance_delta double precision
    CHECK (importance_delta IS NULL OR (importance_delta >= -0.5 AND importance_delta <= 0.5)),
  ranking_version text NOT NULL DEFAULT 'm13-s05-v1',
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by_subject uuid REFERENCES subjects (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, memory_id, scope_key),
  CONSTRAINT memory_personalizations_scope_shape CHECK (
    (
      scope = 'actor'
      AND actor_subject_id IS NOT NULL
      AND scope_key = actor_subject_id::text
    )
    OR (
      scope = 'project_default'
      AND actor_subject_id IS NULL
      AND scope_key = 'project_default'
    )
  )
);

ALTER TABLE memory_personalizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_personalizations FORCE ROW LEVEL SECURITY;

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
        AND mr.project_id = memory_personalizations.project_id
        AND app.has_acl(
          mr.workspace_id,
          'memory',
          'read',
          mr.project_id,
          mr.sensitivity
        )
    )
    AND (
      scope = 'project_default'
      OR actor_subject_id = app.current_subject_id()
    )
  );

CREATE POLICY memory_personalizations_no_insert
  ON memory_personalizations
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY memory_personalizations_no_update
  ON memory_personalizations
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

CREATE POLICY memory_personalizations_no_delete
  ON memory_personalizations
  FOR DELETE
  USING (false);

CREATE INDEX idx_memory_personalizations_project_memory
  ON memory_personalizations (project_id, memory_id, scope_key);
CREATE INDEX idx_memory_personalizations_actor
  ON memory_personalizations (actor_subject_id, project_id, memory_id)
  WHERE actor_subject_id IS NOT NULL;

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
  IF p_pinned IS NULL AND p_importance_delta IS NULL THEN
    RAISE EXCEPTION 'pinned or importance_delta required';
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
  IF v_memory.project_id IS NULL OR v_memory.project_id IS DISTINCT FROM p_project_id THEN
    RAISE EXCEPTION 'project mismatch';
  END IF;
  IF NOT app.is_workspace_member(v_memory.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT app.has_acl(
    v_memory.workspace_id,
    'memory',
    'read',
    v_memory.project_id,
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
    AND project_id = p_project_id
    AND memory_id = p_memory_id
    AND scope_key = v_scope_key
  FOR UPDATE;

  IF v_should_clear THEN
    DELETE FROM memory_personalizations
    WHERE workspace_id = v_memory.workspace_id
      AND project_id = p_project_id
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
        'projectId', p_project_id,
        'memoryId', p_memory_id,
        'scope', v_scope,
        'actorSubjectId', v_actor_subject_id,
        'cleared', true,
        'rankingVersion', 'm13-s05-v1'
      )
    );

    RETURN jsonb_build_object(
      'memoryId', p_memory_id,
      'projectId', p_project_id,
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
    p_project_id,
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
        'memory', to_jsonb(m),
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
              'projectId', m.project_id,
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
          AND mp.project_id = m.project_id
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
      WHERE (p_project_id IS NULL OR m.project_id = p_project_id)
        AND (
          p_include_history
          OR m.status IN ('active', 'verified', 'candidate')
        )
        AND (p_recorded_after IS NULL OR m.recorded_at >= p_recorded_after)
        AND (p_recorded_before IS NULL OR m.recorded_at <= p_recorded_before)
        AND app.has_acl(m.workspace_id, 'memory', 'read', m.project_id, m.sensitivity)
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
