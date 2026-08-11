-- Temporal filters for list/export (recorded_at window)

DROP FUNCTION IF EXISTS public.api_list_memories(text, uuid, uuid, uuid, text, integer);
DROP FUNCTION IF EXISTS app.api_list_memories(text, uuid, uuid, uuid, text, integer);

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
        AND (p_recorded_after IS NULL OR m.recorded_at >= p_recorded_after)
        AND (p_recorded_before IS NULL OR m.recorded_at <= p_recorded_before)
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

GRANT EXECUTE ON FUNCTION app.api_list_memories(text, uuid, uuid, uuid, text, integer, timestamptz, timestamptz)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_list_memories(text, uuid, uuid, uuid, text, integer, timestamptz, timestamptz)
  TO anon, authenticated, service_role;
