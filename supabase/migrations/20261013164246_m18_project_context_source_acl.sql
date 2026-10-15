-- M18.2: keep optional project-state and handoff context behind their own ACLs.
CREATE OR REPLACE FUNCTION app.api_project_context(
  p_secret text,
  p_subject_id uuid,
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.has_acl(
    (SELECT workspace_id FROM projects WHERE id = p_project_id),
    'memory',
    'read',
    p_project_id,
    'internal'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'projectId', p_project_id,
    'decisions', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(m) || jsonb_build_object(
          'effectiveProjectId', app.effective_memory_project_id(m.id)
        )
        ORDER BY m.recorded_at DESC
      )
      FROM memory_records m
      WHERE app.effective_memory_project_id(m.id) = p_project_id
        AND m.memory_type = 'decision'
        AND m.status IN ('active', 'verified')
        AND app.has_acl(
          m.workspace_id,
          'memory',
          'read',
          app.effective_memory_project_id(m.id),
          m.sensitivity
        )
    ), '[]'::jsonb),
    'tasks', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(m) || jsonb_build_object(
          'effectiveProjectId', app.effective_memory_project_id(m.id)
        )
        ORDER BY m.recorded_at DESC
      )
      FROM memory_records m
      WHERE app.effective_memory_project_id(m.id) = p_project_id
        AND m.memory_type = 'task'
        AND m.status IN ('active', 'verified')
        AND app.has_acl(
          m.workspace_id,
          'memory',
          'read',
          app.effective_memory_project_id(m.id),
          m.sensitivity
        )
    ), '[]'::jsonb),
    'facts', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(m) || jsonb_build_object(
          'effectiveProjectId', app.effective_memory_project_id(m.id)
        )
        ORDER BY m.recorded_at DESC
      )
      FROM memory_records m
      WHERE app.effective_memory_project_id(m.id) = p_project_id
        AND m.memory_type = 'fact'
        AND m.status IN ('active', 'verified')
        AND app.has_acl(
          m.workspace_id,
          'memory',
          'read',
          app.effective_memory_project_id(m.id),
          m.sensitivity
        )
    ), '[]'::jsonb),
    'state', (
      SELECT to_jsonb(s)
      FROM project_state_versions s
      WHERE s.project_id = p_project_id
        AND app.has_acl(
          s.workspace_id,
          'project_state',
          'read',
          s.project_id,
          'internal'
        )
      ORDER BY s.version DESC
      LIMIT 1
    ),
    'latestHandoff', (
      SELECT to_jsonb(h)
      FROM handoffs h
      WHERE h.project_id = p_project_id
        AND app.has_acl(
          h.workspace_id,
          'handoff',
          'read',
          h.project_id,
          'internal'
        )
      ORDER BY h.created_at DESC
      LIMIT 1
    )
  ) INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION app.api_project_context(text, uuid, uuid) IS
  'Returns memory context plus optional state/handoff sources only when the subject has each source-specific read ACL.';
