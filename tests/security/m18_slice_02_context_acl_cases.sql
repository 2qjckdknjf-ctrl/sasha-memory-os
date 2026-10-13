\set ON_ERROR_STOP on

DO $$
DECLARE
  v_workspace uuid := '11111111-1111-4111-8111-111111111111';
  v_project uuid := '44444444-4444-4444-8444-444444444402';
  v_subject uuid := '33333333-3333-4333-8333-333333333318';
  v_handoff uuid := '88888888-8888-4888-8888-888888888818';
  v_secret text;
  v_context jsonb;
BEGIN
  SELECT value INTO v_secret
  FROM app.runtime_config
  WHERE key = 'api_secret';

  INSERT INTO subjects (
    id, workspace_id, kind, user_id, external_key, display_name, metadata
  ) VALUES (
    v_subject, v_workspace, 'agent', NULL,
    'm18-context-memory-only', 'M18 context ACL probe', '{}'::jsonb
  );

  INSERT INTO acl_entries (
    workspace_id, subject_id, effect, resource_type,
    project_id, actions, sensitivity_max
  ) VALUES (
    v_workspace, v_subject, 'allow', 'memory',
    v_project, ARRAY['read']::text[], 'internal'
  );

  INSERT INTO handoffs (
    id, workspace_id, project_id, from_subject_id, payload
  ) VALUES (
    v_handoff,
    v_workspace,
    v_project,
    '33333333-3333-4333-8333-333333333301',
    '{"completed":["acl probe"],"blockers":[],"recommended_next":[]}'::jsonb
  );

  v_context := app.api_project_context(v_secret, v_subject, v_project);
  IF v_context->'state' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'memory-only subject received project state';
  END IF;
  IF v_context->'latestHandoff' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'memory-only subject received handoff';
  END IF;

  INSERT INTO acl_entries (
    workspace_id, subject_id, effect, resource_type,
    project_id, actions, sensitivity_max
  ) VALUES (
    v_workspace, v_subject, 'allow', 'project_state',
    v_project, ARRAY['read']::text[], 'internal'
  );

  v_context := app.api_project_context(v_secret, v_subject, v_project);
  IF v_context->'state' IS NULL OR v_context->'state' = 'null'::jsonb THEN
    RAISE EXCEPTION 'project-state read grant did not expose state';
  END IF;
  IF v_context->'latestHandoff' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'project-state grant also exposed handoff';
  END IF;

  INSERT INTO acl_entries (
    workspace_id, subject_id, effect, resource_type,
    project_id, actions, sensitivity_max
  ) VALUES (
    v_workspace, v_subject, 'allow', 'handoff',
    v_project, ARRAY['read']::text[], 'internal'
  );

  v_context := app.api_project_context(v_secret, v_subject, v_project);
  IF (v_context->'latestHandoff'->>'id')::uuid <> v_handoff THEN
    RAISE EXCEPTION 'handoff read grant did not expose latest handoff';
  END IF;
END;
$$;

\echo m18_slice_02_context_acl_cases=pass
