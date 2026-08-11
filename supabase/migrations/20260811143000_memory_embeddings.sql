-- Persist memory embeddings (jsonb + optional pgvector(32) for stub engine)

ALTER TABLE memory_records
  ADD COLUMN IF NOT EXISTS embedding jsonb,
  ADD COLUMN IF NOT EXISTS embedding_vector vector(32),
  ADD COLUMN IF NOT EXISTS embedding_engine text,
  ADD COLUMN IF NOT EXISTS embedding_dims integer,
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_memory_records_embedding_hnsw
  ON memory_records
  USING hnsw (embedding_vector vector_cosine_ops)
  WHERE embedding_vector IS NOT NULL;

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

  IF v_dims = 32 THEN
    v_vector := (
      SELECT array_agg(value::text::float4 ORDER BY ordinality)::vector(32)
      FROM jsonb_array_elements(p_embedding) WITH ORDINALITY AS t(value, ordinality)
    );
  ELSE
    v_vector := NULL;
  END IF;

  UPDATE memory_records
  SET
    embedding = p_embedding,
    embedding_vector = v_vector,
    embedding_engine = nullif(btrim(p_engine), ''),
    embedding_dims = v_dims,
    embedded_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'embedded', true,
      'embedding_engine', nullif(btrim(p_engine), ''),
      'embedding_dims', v_dims
    )
  WHERE id = p_memory_id
  RETURNING * INTO v_memory;

  INSERT INTO audit_log (
    workspace_id, actor_subject_id, action, object_type, object_id, after_state
  ) VALUES (
    v_memory.workspace_id,
    p_subject_id,
    'memory.embed',
    'memory',
    v_memory.id,
    jsonb_build_object(
      'engine', v_memory.embedding_engine,
      'dims', v_memory.embedding_dims,
      'has_vector', v_memory.embedding_vector IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'memoryId', v_memory.id,
    'engine', v_memory.embedding_engine,
    'dims', v_memory.embedding_dims,
    'embeddedAt', v_memory.embedded_at,
    'hasVector', v_memory.embedding_vector IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_set_memory_embedding(
  p_secret text,
  p_subject_id uuid,
  p_memory_id uuid,
  p_embedding jsonb,
  p_engine text DEFAULT 'stub-hash'
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_set_memory_embedding(
    p_secret, p_subject_id, p_memory_id, p_embedding, p_engine
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_set_memory_embedding(text, uuid, uuid, jsonb, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_set_memory_embedding(text, uuid, uuid, jsonb, text)
  TO anon, authenticated, service_role;
