-- Hybrid search: ILIKE lexical + optional query embedding (vector(32)) from API

DROP FUNCTION IF EXISTS public.api_search_memories(text, uuid, text, uuid, boolean);
DROP FUNCTION IF EXISTS app.api_search_memories(text, uuid, text, uuid, boolean);

CREATE OR REPLACE FUNCTION app.api_search_memories(
  p_secret text,
  p_subject_id uuid,
  p_query text,
  p_project_id uuid DEFAULT NULL,
  p_include_history boolean DEFAULT false,
  p_query_embedding jsonb DEFAULT NULL
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
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_query_embedding IS NOT NULL
     AND jsonb_typeof(p_query_embedding) = 'array'
     AND jsonb_array_length(p_query_embedding) = 32 THEN
    v_query_vec := (
      SELECT array_agg(value::text::float4 ORDER BY ordinality)::vector(32)
      FROM jsonb_array_elements(p_query_embedding) WITH ORDINALITY AS t(value, ordinality)
    );
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(hit ORDER BY (hit->>'score')::float8 DESC)
    FROM (
      SELECT jsonb_build_object(
        'memory', to_jsonb(m),
        'score',
          (m.importance * m.confidence)
          * CASE
              WHEN NOT v_has_query THEN 1.0
              WHEN m.title ILIKE '%' || v_query || '%'
                OR m.content ILIKE '%' || v_query || '%' THEN 1.0
              ELSE 0.6
            END
          * CASE
              WHEN v_query_vec IS NULL OR m.embedding_vector IS NULL THEN 1.0
              ELSE 0.7 + 0.3 * greatest(0.0, 1.0 - (m.embedding_vector <=> v_query_vec))
            END,
        'reason',
          CASE
            WHEN v_query_vec IS NOT NULL AND m.embedding_vector IS NOT NULL
              THEN 'hybrid:sql+vector'
            ELSE 'structured+text'
          END
      ) AS hit
      FROM memory_records m
      WHERE (p_project_id IS NULL OR m.project_id = p_project_id)
        AND (
          p_include_history
          OR m.status IN ('active', 'verified', 'candidate')
        )
        AND app.has_acl(m.workspace_id, 'memory', 'read', m.project_id, m.sensitivity)
        AND (
          NOT v_has_query
          OR m.title ILIKE '%' || v_query || '%'
          OR m.content ILIKE '%' || v_query || '%'
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
  p_query_embedding jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_search_memories(
    p_secret, p_subject_id, p_query, p_project_id, p_include_history, p_query_embedding
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_search_memories(text, uuid, text, uuid, boolean, jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_search_memories(text, uuid, text, uuid, boolean, jsonb)
  TO anon, authenticated, service_role;
