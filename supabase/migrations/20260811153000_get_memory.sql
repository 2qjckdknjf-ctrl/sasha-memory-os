-- Full memory row for owner re-embed / ops (list_memories truncates content)

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

  IF NOT app.has_acl(
    v_row.workspace_id,
    'memory',
    'read',
    v_row.project_id,
    v_row.sensitivity
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'title', v_row.title,
    'content', v_row.content,
    'status', v_row.status,
    'sensitivity', v_row.sensitivity,
    'memoryType', v_row.memory_type,
    'projectId', v_row.project_id,
    'workspaceId', v_row.workspace_id,
    'recordedAt', v_row.recorded_at,
    'metadata', v_row.metadata,
    'embedding', v_row.embedding,
    'embeddingEngine', v_row.embedding_engine,
    'embeddingDims', v_row.embedding_dims
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_get_memory(
  p_secret text,
  p_subject_id uuid,
  p_memory_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_get_memory(p_secret, p_subject_id, p_memory_id)
$$;

GRANT EXECUTE ON FUNCTION app.api_get_memory(text, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_get_memory(text, uuid, uuid)
  TO anon, authenticated, service_role;
