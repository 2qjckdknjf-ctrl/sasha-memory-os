-- Consolidation: mark duplicate memory superseded by keeper (owner only)

CREATE OR REPLACE FUNCTION app.api_supersede_memory(
  p_secret text,
  p_subject_id uuid,
  p_duplicate_id uuid,
  p_keeper_id uuid,
  p_reason text DEFAULT 'consolidation: near-duplicate candidate'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_dup memory_records%ROWTYPE;
  v_keeper memory_records%ROWTYPE;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'consolidation: near-duplicate candidate');
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_duplicate_id = p_keeper_id THEN
    RAISE EXCEPTION 'duplicate and keeper must differ';
  END IF;

  SELECT * INTO v_dup FROM memory_records WHERE id = p_duplicate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'duplicate memory not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_keeper FROM memory_records WHERE id = p_keeper_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'keeper memory not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_dup.workspace_id <> v_keeper.workspace_id THEN
    RAISE EXCEPTION 'workspace mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM workspace_memberships wm
    WHERE wm.workspace_id = v_dup.workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE memory_records
  SET
    status = 'superseded',
    superseded_by = v_keeper.id,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'status_reason', v_reason,
      'status_actor', p_subject_id,
      'status_at', now(),
      'consolidated_into', v_keeper.id
    )
  WHERE id = v_dup.id
  RETURNING * INTO v_dup;

  UPDATE memory_records
  SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'consolidated_from', coalesce(metadata->'consolidated_from', '[]'::jsonb) || jsonb_build_array(v_dup.id),
    'consolidated_at', now()
  )
  WHERE id = v_keeper.id
  RETURNING * INTO v_keeper;

  INSERT INTO audit_log (
    workspace_id, actor_subject_id, action, object_type, object_id, after_state
  ) VALUES (
    v_dup.workspace_id,
    p_subject_id,
    'memory.supersede',
    'memory',
    v_dup.id,
    jsonb_build_object(
      'duplicate_id', v_dup.id,
      'keeper_id', v_keeper.id,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'duplicateId', v_dup.id,
    'keeperId', v_keeper.id,
    'status', v_dup.status,
    'supersededBy', v_dup.superseded_by,
    'reason', v_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_supersede_memory(
  p_secret text,
  p_subject_id uuid,
  p_duplicate_id uuid,
  p_keeper_id uuid,
  p_reason text DEFAULT 'consolidation: near-duplicate candidate'
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_supersede_memory(
    p_secret, p_subject_id, p_duplicate_id, p_keeper_id, p_reason
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_supersede_memory(text, uuid, uuid, uuid, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_supersede_memory(text, uuid, uuid, uuid, text)
  TO anon, authenticated, service_role;
