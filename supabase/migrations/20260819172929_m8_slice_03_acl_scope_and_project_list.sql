-- M8 Slice 03 follow-up: project-scoped ACL semantics, collection merge RPCs, and projects list

CREATE OR REPLACE FUNCTION app.project_scope_matches(
  p_acl_project_id uuid,
  p_requested_project_id uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, app
AS $$
  SELECT CASE
    WHEN p_requested_project_id IS NULL THEN p_acl_project_id IS NULL
    ELSE p_acl_project_id = p_requested_project_id
  END;
$$;

CREATE OR REPLACE FUNCTION app.has_acl(
  p_workspace_id uuid,
  p_resource_type text,
  p_action text,
  p_project_id uuid DEFAULT NULL,
  p_sensitivity text DEFAULT 'internal'
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_subject uuid := app.current_subject_id();
  v_denied boolean;
  v_allowed boolean;
BEGIN
  IF v_subject IS NULL THEN
    RETURN false;
  END IF;

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM acl_entries a
    WHERE a.workspace_id = p_workspace_id
      AND a.subject_id = v_subject
      AND a.effect = 'deny'
      AND a.resource_type IN (p_resource_type, '*')
      AND app.project_scope_matches(a.project_id, p_project_id)
      AND (a.actions = '{}' OR p_action = ANY (a.actions))
  ) INTO v_denied;

  IF v_denied THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.subject_id = v_subject
      AND wm.role = 'owner'
  ) THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM acl_entries a
    WHERE a.workspace_id = p_workspace_id
      AND a.subject_id = v_subject
      AND a.effect = 'allow'
      AND a.resource_type IN (p_resource_type, '*')
      AND app.project_scope_matches(a.project_id, p_project_id)
      AND (a.actions = '{}' OR p_action = ANY (a.actions))
      AND (
        a.sensitivity_max IS NULL
        OR app.sensitivity_rank(p_sensitivity) <= app.sensitivity_rank(a.sensitivity_max)
      )
  ) INTO v_allowed;

  RETURN v_allowed;
END;
$$;

CREATE OR REPLACE FUNCTION app.api_refresh_connection_collections(
  p_secret text,
  p_subject_id uuid,
  p_connection_id uuid,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_project_bindings jsonb DEFAULT '{}'::jsonb,
  p_discovered_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_row connector_accounts%ROWTYPE;
  v_collections jsonb;
  v_excluded jsonb;
  v_bindings jsonb;
  v_synced_at jsonb;
  v_discovered jsonb := to_jsonb(coalesce(p_discovered_at, now()));
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT * INTO v_row
  FROM connector_accounts
  WHERE id = p_connection_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member(v_row.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_collections := coalesce(v_row.metadata->'collections', '{}'::jsonb);
  v_excluded := CASE
    WHEN jsonb_typeof(v_collections->'excluded_ids') = 'array' THEN v_collections->'excluded_ids'
    ELSE '[]'::jsonb
  END;
  v_bindings := CASE
    WHEN jsonb_typeof(v_collections->'project_bindings') = 'object' THEN v_collections->'project_bindings'
    ELSE '{}'::jsonb
  END;
  v_synced_at := coalesce(v_collections->'synced_at', 'null'::jsonb);

  UPDATE connector_accounts
  SET
    metadata = coalesce(v_row.metadata, '{}'::jsonb) || jsonb_build_object(
      'collections',
      jsonb_build_object(
        'selection_mode', 'all',
        'excluded_ids', v_excluded,
        'items', CASE
          WHEN jsonb_typeof(p_items) = 'array' THEN p_items
          ELSE '[]'::jsonb
        END,
        'discovered_at', v_discovered,
        'synced_at', v_synced_at,
        'project_bindings', v_bindings || CASE
          WHEN jsonb_typeof(p_project_bindings) = 'object' THEN p_project_bindings
          ELSE '{}'::jsonb
        END
      )
    ),
    updated_at = now()
  WHERE id = p_connection_id
  RETURNING * INTO v_row;

  RETURN app.connection_response_with_metadata(v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_refresh_connection_collections(
  p_secret text,
  p_subject_id uuid,
  p_connection_id uuid,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_project_bindings jsonb DEFAULT '{}'::jsonb,
  p_discovered_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_refresh_connection_collections(
    p_secret,
    p_subject_id,
    p_connection_id,
    p_items,
    p_project_bindings,
    p_discovered_at
  );
$$;

CREATE OR REPLACE FUNCTION app.api_set_connection_collection_exclusions(
  p_secret text,
  p_subject_id uuid,
  p_connection_id uuid,
  p_excluded_ids text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_row connector_accounts%ROWTYPE;
  v_collections jsonb;
  v_items jsonb;
  v_bindings jsonb;
  v_discovered_at jsonb;
  v_synced_at jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT * INTO v_row
  FROM connector_accounts
  WHERE id = p_connection_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member(v_row.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_collections := coalesce(v_row.metadata->'collections', '{}'::jsonb);
  v_items := CASE
    WHEN jsonb_typeof(v_collections->'items') = 'array' THEN v_collections->'items'
    ELSE '[]'::jsonb
  END;
  v_bindings := CASE
    WHEN jsonb_typeof(v_collections->'project_bindings') = 'object' THEN v_collections->'project_bindings'
    ELSE '{}'::jsonb
  END;
  v_discovered_at := coalesce(v_collections->'discovered_at', 'null'::jsonb);
  v_synced_at := coalesce(v_collections->'synced_at', 'null'::jsonb);

  UPDATE connector_accounts
  SET
    metadata = coalesce(v_row.metadata, '{}'::jsonb) || jsonb_build_object(
      'collections',
      jsonb_build_object(
        'selection_mode', 'all',
        'excluded_ids', to_jsonb(coalesce(p_excluded_ids, '{}'::text[])),
        'items', v_items,
        'discovered_at', v_discovered_at,
        'synced_at', v_synced_at,
        'project_bindings', v_bindings
      )
    ),
    updated_at = now()
  WHERE id = p_connection_id
  RETURNING * INTO v_row;

  RETURN app.connection_response_with_metadata(v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_set_connection_collection_exclusions(
  p_secret text,
  p_subject_id uuid,
  p_connection_id uuid,
  p_excluded_ids text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_set_connection_collection_exclusions(
    p_secret,
    p_subject_id,
    p_connection_id,
    p_excluded_ids
  );
$$;

CREATE OR REPLACE FUNCTION app.api_list_projects(
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
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'slug', p.slug,
        'name', p.name,
        'status', p.status,
        'url', repo.url
      )
      ORDER BY p.name, p.slug
    )
    FROM projects p
    LEFT JOIN LATERAL (
      SELECT nullif(value->>'url', '') AS url
      FROM jsonb_array_elements(coalesce(p.repositories, '[]'::jsonb))
      ORDER BY value->>'collection_id'
      LIMIT 1
    ) repo ON true
    WHERE p.workspace_id = p_workspace_id
      AND app.has_acl(p.workspace_id, 'project', 'read', p.id)
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_list_projects(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_list_projects(p_secret, p_subject_id, p_workspace_id);
$$;

CREATE OR REPLACE FUNCTION app.api_list_project_hints(
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
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'slug', p.slug,
        'name', p.name,
        'status', p.status,
        'url', repo.url
      )
      ORDER BY p.name, p.slug
    )
    FROM projects p
    LEFT JOIN LATERAL (
      SELECT nullif(value->>'url', '') AS url
      FROM jsonb_array_elements(coalesce(p.repositories, '[]'::jsonb))
      ORDER BY value->>'collection_id'
      LIMIT 1
    ) repo ON true
    WHERE p.workspace_id = p_workspace_id
      AND (
        app.has_acl(p.workspace_id, 'memory', 'read', p.id, 'internal')
        OR app.has_acl(p.workspace_id, 'memory', 'write', p.id, 'internal')
      )
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_list_project_hints(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_list_project_hints(p_secret, p_subject_id, p_workspace_id);
$$;

CREATE OR REPLACE FUNCTION app.api_resolve_project_ref(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_ref text := lower(nullif(btrim(coalesce(p_project_ref, '')), ''));
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_ref IS NULL THEN
    RETURN jsonb_build_object(
      'projectId', NULL,
      'matchCount', 0,
      'candidates', '[]'::jsonb
    );
  END IF;

  RETURN COALESCE((
    WITH project_candidates AS (
      SELECT DISTINCT
        p.id,
        p.slug,
        p.name,
        repo.url
      FROM projects p
      LEFT JOIN LATERAL (
        SELECT
          nullif(value->>'url', '') AS url,
          lower(coalesce(nullif(value->>'collection_id', ''), '')) AS collection_id,
          lower(coalesce(nullif(value->>'external_id', ''), '')) AS external_id,
          lower(coalesce(nullif(value->'metadata'->>'full_name', ''), '')) AS full_name
        FROM jsonb_array_elements(coalesce(p.repositories, '[]'::jsonb)) repo_values(value)
      ) repo ON true
      WHERE p.workspace_id = p_workspace_id
        AND (
          app.has_acl(p.workspace_id, 'memory', 'read', p.id, 'internal')
          OR app.has_acl(p.workspace_id, 'memory', 'write', p.id, 'internal')
          OR app.has_acl(p.workspace_id, 'handoff', 'write', p.id)
        )
        AND (
          lower(p.id::text) = v_ref
          OR lower(p.slug) = v_ref
          OR lower(p.name) = v_ref
          OR lower(coalesce(repo.url, '')) = v_ref
          OR repo.collection_id = v_ref
          OR repo.external_id = v_ref
          OR repo.full_name = v_ref
        )
    )
    SELECT jsonb_build_object(
      'projectId', CASE WHEN count(*) = 1 THEN min(id)::text ELSE NULL END,
      'matchCount', count(*),
      'candidates', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', id,
            'slug', slug,
            'name', name,
            'url', url
          )
          ORDER BY name, slug
        ),
        '[]'::jsonb
      )
    )
    FROM project_candidates
  ), jsonb_build_object(
    'projectId', NULL,
    'matchCount', 0,
    'candidates', '[]'::jsonb
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.api_resolve_project_ref(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_resolve_project_ref(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_project_ref
  );
$$;

INSERT INTO acl_entries (
  workspace_id, subject_id, effect, resource_type, project_id, actions, sensitivity_max
)
SELECT p.id, s.id, 'allow', t.resource_type, NULL, t.actions, t.sensitivity_max
FROM workspaces p
JOIN subjects s ON s.workspace_id = p.id
JOIN (
  VALUES
    ('chatgpt', 'memory', ARRAY['read', 'write']::text[], 'internal'),
    ('chatgpt', 'handoff', ARRAY['read', 'write']::text[], 'internal'),
    ('cursor', 'memory', ARRAY['read', 'write']::text[], 'internal'),
    ('cursor', 'handoff', ARRAY['read', 'write']::text[], 'internal')
) AS t(actor_key, resource_type, actions, sensitivity_max)
  ON s.external_key = t.actor_key
WHERE NOT EXISTS (
  SELECT 1
  FROM acl_entries a
  WHERE a.workspace_id = p.id
    AND a.subject_id = s.id
    AND a.effect = 'allow'
    AND a.resource_type = t.resource_type
    AND a.project_id IS NULL
    AND a.actions = t.actions
    AND coalesce(a.sensitivity_max, '') = coalesce(t.sensitivity_max, '')
);

INSERT INTO acl_entries (
  workspace_id, subject_id, effect, resource_type, project_id, actions, sensitivity_max
)
SELECT s.workspace_id, s.id, 'allow', 'memory', '44444444-4444-4444-8444-444444444401', ARRAY['read', 'write']::text[], 'internal'
FROM subjects s
WHERE s.external_key = 'cursor'
  AND NOT EXISTS (
    SELECT 1
    FROM acl_entries a
    WHERE a.workspace_id = s.workspace_id
      AND a.subject_id = s.id
      AND a.effect = 'allow'
      AND a.resource_type = 'memory'
      AND a.project_id = '44444444-4444-4444-8444-444444444401'
      AND a.actions = ARRAY['read', 'write']::text[]
      AND coalesce(a.sensitivity_max, '') = 'internal'
  );

GRANT EXECUTE ON FUNCTION app.project_scope_matches(uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_refresh_connection_collections(text, uuid, uuid, jsonb, jsonb, timestamptz)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_refresh_connection_collections(text, uuid, uuid, jsonb, jsonb, timestamptz)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_set_connection_collection_exclusions(text, uuid, uuid, text[])
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_set_connection_collection_exclusions(text, uuid, uuid, text[])
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_list_projects(text, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_list_projects(text, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_list_project_hints(text, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_list_project_hints(text, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_resolve_project_ref(text, uuid, uuid, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_resolve_project_ref(text, uuid, uuid, text)
  TO anon, authenticated, service_role;
