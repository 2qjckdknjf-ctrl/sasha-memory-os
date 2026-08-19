-- M7: ROMA first-class agent identity (service-style seed client, no automation jobs)

INSERT INTO subjects (
  id,
  workspace_id,
  kind,
  user_id,
  external_key,
  display_name,
  metadata
)
VALUES (
  '33333333-3333-4333-8333-333333333304',
  '11111111-1111-4111-8111-111111111111',
  'agent',
  NULL,
  'roma',
  'ROMA',
  '{
    "purpose": "Аудит, QA и findings по явно разрешенным проектам без наследования owner-прав.",
    "allowed_tools": [
      "memory.search",
      "memory.get",
      "context.project",
      "capture.text",
      "handoff.create",
      "memory.set_status"
    ]
  }'::jsonb
)
ON CONFLICT (workspace_id, kind, external_key) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  metadata = EXCLUDED.metadata;

INSERT INTO agents (workspace_id, subject_id, client_key, version, capabilities, trust_level)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333304',
  'roma',
  '1',
  '["memory.read.project","memory.write.findings","qa.read","handoff.write"]'::jsonb,
  'standard'
)
ON CONFLICT (workspace_id, client_key) DO UPDATE
SET
  subject_id = EXCLUDED.subject_id,
  version = EXCLUDED.version,
  capabilities = EXCLUDED.capabilities,
  trust_level = EXCLUDED.trust_level;

INSERT INTO api_clients (workspace_id, subject_id, client_id, audience)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333304',
  'demo-roma',
  ARRAY['memory-api', 'mcp']
)
ON CONFLICT (workspace_id, client_id) DO UPDATE
SET
  subject_id = EXCLUDED.subject_id,
  audience = EXCLUDED.audience;

INSERT INTO acl_entries (
  workspace_id,
  subject_id,
  effect,
  resource_type,
  project_id,
  actions,
  sensitivity_max
)
SELECT
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333304',
  'allow',
  'memory',
  '44444444-4444-4444-8444-444444444401',
  ARRAY['read', 'write'],
  'internal'
WHERE NOT EXISTS (
  SELECT 1
  FROM acl_entries
  WHERE workspace_id = '11111111-1111-4111-8111-111111111111'
    AND subject_id = '33333333-3333-4333-8333-333333333304'
    AND effect = 'allow'
    AND resource_type = 'memory'
    AND project_id = '44444444-4444-4444-8444-444444444401'
    AND actions = ARRAY['read', 'write']
    AND sensitivity_max = 'internal'
);

INSERT INTO acl_entries (
  workspace_id,
  subject_id,
  effect,
  resource_type,
  project_id,
  actions,
  sensitivity_max
)
SELECT
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333304',
  'allow',
  'project',
  '44444444-4444-4444-8444-444444444401',
  ARRAY['read'],
  'internal'
WHERE NOT EXISTS (
  SELECT 1
  FROM acl_entries
  WHERE workspace_id = '11111111-1111-4111-8111-111111111111'
    AND subject_id = '33333333-3333-4333-8333-333333333304'
    AND effect = 'allow'
    AND resource_type = 'project'
    AND project_id = '44444444-4444-4444-8444-444444444401'
    AND actions = ARRAY['read']
    AND sensitivity_max = 'internal'
);

INSERT INTO acl_entries (
  workspace_id,
  subject_id,
  effect,
  resource_type,
  project_id,
  actions,
  sensitivity_max
)
SELECT
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333304',
  'allow',
  'project_state',
  '44444444-4444-4444-8444-444444444401',
  ARRAY['read'],
  'internal'
WHERE NOT EXISTS (
  SELECT 1
  FROM acl_entries
  WHERE workspace_id = '11111111-1111-4111-8111-111111111111'
    AND subject_id = '33333333-3333-4333-8333-333333333304'
    AND effect = 'allow'
    AND resource_type = 'project_state'
    AND project_id = '44444444-4444-4444-8444-444444444401'
    AND actions = ARRAY['read']
    AND sensitivity_max = 'internal'
);

INSERT INTO acl_entries (
  workspace_id,
  subject_id,
  effect,
  resource_type,
  project_id,
  actions,
  sensitivity_max
)
SELECT
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333304',
  'allow',
  'handoff',
  '44444444-4444-4444-8444-444444444401',
  ARRAY['read', 'write'],
  'internal'
WHERE NOT EXISTS (
  SELECT 1
  FROM acl_entries
  WHERE workspace_id = '11111111-1111-4111-8111-111111111111'
    AND subject_id = '33333333-3333-4333-8333-333333333304'
    AND effect = 'allow'
    AND resource_type = 'handoff'
    AND project_id = '44444444-4444-4444-8444-444444444401'
    AND actions = ARRAY['read', 'write']
    AND sensitivity_max = 'internal'
);

CREATE OR REPLACE FUNCTION app.api_list_agent_rights(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_current_actor jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'subjectId', s.id,
    'isOwner', EXISTS (
      SELECT 1
      FROM workspace_memberships wm
      WHERE wm.workspace_id = s.workspace_id
        AND wm.subject_id = s.id
        AND wm.role = 'owner'
    ),
    'actor', jsonb_build_object(
      'id', s.id,
      'externalKey', s.external_key,
      'displayName', s.display_name,
      'kind', s.kind
    )
  ) INTO v_current_actor
  FROM subjects s
  WHERE s.id = p_subject_id
    AND s.workspace_id = p_workspace_id;

  RETURN jsonb_build_object(
    'currentActor',
    v_current_actor,
    'actors',
    COALESCE((
      SELECT jsonb_agg(actor_row ORDER BY actor_order)
      FROM (
        SELECT
          CASE s.external_key
            WHEN 'owner' THEN 1
            WHEN 'chatgpt' THEN 2
            WHEN 'cursor' THEN 3
            WHEN 'roma' THEN 4
            ELSE 99
          END AS actor_order,
          jsonb_build_object(
            'subjectId', s.id,
            'externalKey', s.external_key,
            'displayName', s.display_name,
            'kind', s.kind,
            'isOwner', EXISTS (
              SELECT 1
              FROM workspace_memberships wm
              WHERE wm.workspace_id = s.workspace_id
                AND wm.subject_id = s.id
                AND wm.role = 'owner'
            ),
            'purpose', nullif(btrim(coalesce(s.metadata->>'purpose', '')), ''),
            'allowedTools', coalesce(s.metadata->'allowed_tools', '[]'::jsonb),
            'scopes', CASE
              WHEN EXISTS (
                SELECT 1
                FROM workspace_memberships wm
                WHERE wm.workspace_id = s.workspace_id
                  AND wm.subject_id = s.id
                  AND wm.role = 'owner'
              ) THEN to_jsonb(ARRAY[
                'workspace.owner',
                'memory.export',
                'connections.manage'
              ]::text[])
              ELSE COALESCE((
                SELECT to_jsonb(array_agg(
                  format(
                    '%s.%s@%s<=%s',
                    a.resource_type,
                    CASE
                      WHEN coalesce(array_length(a.actions, 1), 0) = 0 THEN 'all'
                      ELSE array_to_string(a.actions, '+')
                    END,
                    coalesce(a.project_id::text, 'workspace'),
                    coalesce(a.sensitivity_max, 'all')
                  )
                  ORDER BY a.resource_type, a.project_id
                ))
                FROM acl_entries a
                WHERE a.workspace_id = s.workspace_id
                  AND a.subject_id = s.id
                  AND a.effect = 'allow'
              ), '[]'::jsonb)
            END,
            'capabilities', coalesce(ag.capabilities, '[]'::jsonb),
            'rights', CASE
              WHEN EXISTS (
                SELECT 1
                FROM workspace_memberships wm
                WHERE wm.workspace_id = s.workspace_id
                  AND wm.subject_id = s.id
                  AND wm.role = 'owner'
              ) THEN jsonb_build_array(
                jsonb_build_object(
                  'effect', 'allow',
                  'resourceType', '*',
                  'projectId', NULL,
                  'actions', ARRAY['read', 'write'],
                  'sensitivityMax', NULL,
                  'source', 'workspace_owner'
                )
              )
              ELSE COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'effect', a.effect,
                    'resourceType', a.resource_type,
                    'projectId', a.project_id,
                    'actions', a.actions,
                    'sensitivityMax', a.sensitivity_max,
                    'source', 'acl'
                  )
                  ORDER BY a.resource_type, a.project_id
                )
                FROM acl_entries a
                WHERE a.workspace_id = s.workspace_id
                  AND a.subject_id = s.id
              ), '[]'::jsonb)
            END
          ) AS actor_row
        FROM subjects s
        LEFT JOIN agents ag
          ON ag.workspace_id = s.workspace_id
         AND ag.subject_id = s.id
        WHERE s.workspace_id = p_workspace_id
          AND s.external_key IN ('owner', 'chatgpt', 'cursor', 'roma')
      ) rows
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_list_agent_rights(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_list_agent_rights(
    p_secret,
    p_subject_id,
    p_workspace_id
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_list_agent_rights(text, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_list_agent_rights(text, uuid, uuid)
  TO anon, authenticated, service_role;
