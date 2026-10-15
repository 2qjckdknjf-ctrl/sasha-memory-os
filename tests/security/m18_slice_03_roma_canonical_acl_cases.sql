\set ON_ERROR_STOP on

DO $$
DECLARE
  v_workspace constant uuid := '11111111-1111-4111-8111-111111111111';
  v_project constant uuid := '44444444-4444-4444-8444-444444444402';
  v_owner constant uuid := '33333333-3333-4333-8333-333333333301';
  v_roma constant uuid := '33333333-3333-4333-8333-333333333304';
  v_secret text;
  v_context jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM acl_entries
    WHERE workspace_id = v_workspace
      AND subject_id = v_roma
      AND effect = 'allow'
      AND resource_type = 'project'
      AND project_id = v_project
      AND (actions = '{}'::text[] OR 'read' = ANY (actions))
      AND (
        sensitivity_max IS NULL
        OR app.sensitivity_rank('internal') <= app.sensitivity_rank(sensitivity_max)
      )
  ) THEN
    RAISE EXCEPTION 'ROMA canonical project read grant missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM acl_entries
    WHERE workspace_id = v_workspace
      AND subject_id = v_roma
      AND effect = 'allow'
      AND resource_type = 'memory'
      AND project_id = v_project
      AND (actions = '{}'::text[] OR ARRAY['read', 'write']::text[] <@ actions)
      AND (
        sensitivity_max IS NULL
        OR app.sensitivity_rank('internal') <= app.sensitivity_rank(sensitivity_max)
      )
  ) THEN
    RAISE EXCEPTION 'ROMA canonical memory read/write grant missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM acl_entries
    WHERE workspace_id = v_workspace
      AND subject_id = v_roma
      AND effect = 'allow'
      AND resource_type = 'project_state'
      AND project_id = v_project
      AND (actions = '{}'::text[] OR 'read' = ANY (actions))
  ) THEN
    RAISE EXCEPTION 'ROMA canonical project-state read grant missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM acl_entries
    WHERE workspace_id = v_workspace
      AND subject_id = v_roma
      AND effect = 'allow'
      AND resource_type = 'handoff'
      AND project_id = v_project
      AND actions = ARRAY['read']::text[]
  ) THEN
    RAISE EXCEPTION 'ROMA canonical handoff read-only grant missing';
  END IF;

  PERFORM app.with_subject(v_owner);
  PERFORM app.assert_roma_project_health_schedule_access(v_workspace, v_project);

  SELECT value INTO STRICT v_secret
  FROM app.runtime_config
  WHERE key = 'api_secret';

  v_context := app.api_project_context(v_secret, v_roma, v_project);
  IF (v_context->>'projectId')::uuid <> v_project THEN
    RAISE EXCEPTION 'ROMA canonical project context did not preserve explicit project scope';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM acl_entries
    WHERE workspace_id = v_workspace
      AND subject_id = v_roma
      AND effect = 'allow'
      AND project_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ROMA received a workspace-wide ACL grant';
  END IF;
END;
$$;

\echo m18_slice_03_roma_canonical_acl_cases=pass
