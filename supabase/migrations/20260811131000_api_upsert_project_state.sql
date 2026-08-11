CREATE OR REPLACE FUNCTION app.api_upsert_project_state(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_expected_version integer,
  p_state jsonb,
  p_summary text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_actual integer;
  v_id uuid;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.has_acl(p_workspace_id, 'project_state', 'write', p_project_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(max(version), 0) INTO v_actual
  FROM project_state_versions
  WHERE project_id = p_project_id;

  IF v_actual <> p_expected_version THEN
    RAISE EXCEPTION 'project state version conflict: expected %, actual %',
      p_expected_version, v_actual
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO project_state_versions (
    workspace_id, project_id, version, state, summary, created_by_subject
  ) VALUES (
    p_workspace_id, p_project_id, v_actual + 1, p_state, p_summary, p_subject_id
  )
  RETURNING id INTO v_id;

  RETURN (SELECT to_jsonb(s) FROM project_state_versions s WHERE s.id = v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_upsert_project_state(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_expected_version integer,
  p_state jsonb,
  p_summary text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_upsert_project_state(
    p_secret, p_subject_id, p_workspace_id, p_project_id,
    p_expected_version, p_state, p_summary
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_upsert_project_state(text, uuid, uuid, uuid, integer, jsonb, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_upsert_project_state(text, uuid, uuid, uuid, integer, jsonb, text)
  TO anon, authenticated, service_role;
