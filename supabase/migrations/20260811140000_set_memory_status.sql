-- Owner/reviewer correction path: approve/reject/retract candidate memories

CREATE OR REPLACE FUNCTION app.api_set_memory_status(
  p_secret text,
  p_subject_id uuid,
  p_memory_id uuid,
  p_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_row memory_records%ROWTYPE;
  v_status text := btrim(p_status);
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF v_status NOT IN (
    'candidate', 'active', 'verified', 'disputed', 'superseded', 'retracted', 'deleted'
  ) THEN
    RAISE EXCEPTION 'invalid status: %', v_status;
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason required';
  END IF;

  SELECT * INTO v_row
  FROM memory_records
  WHERE id = p_memory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'memory not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member(v_row.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Non-owners may only dispute; owners may set any review status.
  IF NOT EXISTS (
    SELECT 1 FROM workspace_memberships wm
    WHERE wm.workspace_id = v_row.workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) THEN
    IF v_status <> 'disputed' THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE memory_records
  SET
    status = v_status,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'status_reason', btrim(p_reason),
      'status_actor', p_subject_id,
      'status_at', now()
    )
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO audit_log (
    workspace_id, actor_subject_id, action, object_type, object_id, after_state
  ) VALUES (
    v_row.workspace_id,
    p_subject_id,
    'memory.set_status',
    'memory',
    v_row.id,
    jsonb_build_object('status', v_status, 'reason', btrim(p_reason))
  );

  RETURN jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'projectId', v_row.project_id,
    'title', v_row.title,
    'reason', btrim(p_reason)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_set_memory_status(
  p_secret text,
  p_subject_id uuid,
  p_memory_id uuid,
  p_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_set_memory_status(
    p_secret, p_subject_id, p_memory_id, p_status, p_reason
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_set_memory_status(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_set_memory_status(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
