-- Optional HQ vectors (OpenAI 1536) alongside alpha stub vector(32)

ALTER TABLE memory_records
  ADD COLUMN IF NOT EXISTS embedding_vector_hq vector(1536);

CREATE INDEX IF NOT EXISTS idx_memory_records_embedding_hq_hnsw
  ON memory_records
  USING hnsw (embedding_vector_hq vector_cosine_ops)
  WHERE embedding_vector_hq IS NOT NULL;

CREATE OR REPLACE FUNCTION app.api_set_memory_embedding(
  p_secret text,
  p_subject_id uuid,
  p_memory_id uuid,
  p_embedding jsonb,
  p_engine text DEFAULT 'stub-hash'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_memory memory_records%ROWTYPE;
  v_dims int;
  v_vector vector(32);
  v_vector_hq vector(1536);
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_embedding IS NULL OR jsonb_typeof(p_embedding) <> 'array' THEN
    RAISE EXCEPTION 'embedding must be a json array';
  END IF;

  v_dims := jsonb_array_length(p_embedding);
  IF v_dims IS NULL OR v_dims < 1 THEN
    RAISE EXCEPTION 'embedding array empty';
  END IF;

  SELECT * INTO v_memory
  FROM memory_records
  WHERE id = p_memory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'memory not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.has_acl(
    v_memory.workspace_id, 'memory', 'write', v_memory.project_id, v_memory.sensitivity
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_vector := NULL;
  v_vector_hq := NULL;
  IF v_dims = 32 THEN
    v_vector := (
      SELECT array_agg(value::text::float4 ORDER BY ordinality)::vector(32)
      FROM jsonb_array_elements(p_embedding) WITH ORDINALITY AS t(value, ordinality)
    );
  ELSIF v_dims = 1536 THEN
    v_vector_hq := (
      SELECT array_agg(value::text::float4 ORDER BY ordinality)::vector(1536)
      FROM jsonb_array_elements(p_embedding) WITH ORDINALITY AS t(value, ordinality)
    );
  END IF;

  UPDATE memory_records
  SET
    embedding = p_embedding,
    embedding_vector = COALESCE(v_vector, embedding_vector),
    embedding_vector_hq = COALESCE(v_vector_hq, embedding_vector_hq),
    embedding_engine = nullif(btrim(p_engine), ''),
    embedding_dims = v_dims,
    embedded_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'embedded', true,
      'embedding_engine', nullif(btrim(p_engine), ''),
      'embedding_dims', v_dims
    )
  WHERE id = v_memory.id
  RETURNING * INTO v_memory;

  RETURN jsonb_build_object(
    'memoryId', v_memory.id,
    'engine', v_memory.embedding_engine,
    'dims', v_memory.embedding_dims,
    'embeddedAt', v_memory.embedded_at,
    'hasVector', (v_memory.embedding_vector IS NOT NULL OR v_memory.embedding_vector_hq IS NOT NULL)
  );
END;
$$;

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
  v_query_vec_hq vector(1536);
  v_qdims int := 0;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

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
          (m.importance * m.confidence)
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
