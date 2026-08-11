-- Expose embedding vectors on list_memories for consolidation / hybrid clients

CREATE OR REPLACE FUNCTION app.api_list_memories(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
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

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', m.id,
      'title', m.title,
      'content', left(m.content, 500),
      'status', m.status,
      'sensitivity', m.sensitivity,
      'memoryType', m.memory_type,
      'projectId', m.project_id,
      'recordedAt', m.recorded_at,
      'metadata', m.metadata,
      'embedding', m.embedding,
      'embeddingEngine', m.embedding_engine,
      'embeddingDims', m.embedding_dims
    ) ORDER BY m.recorded_at DESC)
    FROM (
      SELECT m.*
      FROM memory_records m
      WHERE m.workspace_id = p_workspace_id
        AND (p_project_id IS NULL OR m.project_id = p_project_id)
        AND (p_status IS NULL OR btrim(p_status) = '' OR m.status = p_status)
        AND app.has_acl(
          m.workspace_id,
          'memory',
          'read',
          m.project_id,
          m.sensitivity
        )
      ORDER BY m.recorded_at DESC
      LIMIT v_limit
    ) m
  ), '[]'::jsonb);
END;
$$;
