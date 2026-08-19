-- M8 Slice 03: discovered collections, auto-project ingest, and workspace chat fallback

ALTER TABLE handoffs
  ALTER COLUMN project_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_handoffs_workspace_created
  ON handoffs (workspace_id, created_at DESC);

CREATE OR REPLACE FUNCTION app.slugify_project_value(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, app
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR btrim(p_value) = '' THEN 'project'
    ELSE trim(both '-' FROM regexp_replace(lower(p_value), '[^a-z0-9]+', '-', 'g'))
  END;
$$;

CREATE OR REPLACE FUNCTION app.merge_project_repositories(
  p_existing jsonb,
  p_repo jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, app
AS $$
  WITH combined AS (
    SELECT value AS repo
    FROM jsonb_array_elements(coalesce(p_existing, '[]'::jsonb))
    UNION ALL
    SELECT coalesce(p_repo, '{}'::jsonb)
  ),
  ranked AS (
    SELECT
      repo,
      coalesce(
        nullif(repo->>'url', ''),
        nullif(repo->>'external_id', ''),
        nullif(repo->>'collection_id', ''),
        md5(repo::text)
      ) AS dedupe_key,
      row_number() OVER (
        PARTITION BY coalesce(
          nullif(repo->>'url', ''),
          nullif(repo->>'external_id', ''),
          nullif(repo->>'collection_id', ''),
          md5(repo::text)
        )
        ORDER BY CASE WHEN repo = coalesce(p_repo, '{}'::jsonb) THEN 0 ELSE 1 END
      ) AS rn
    FROM combined
  )
  SELECT coalesce(
    jsonb_agg(repo ORDER BY repo->>'provider', repo->>'collection_id'),
    '[]'::jsonb
  )
  FROM ranked
  WHERE rn = 1;
$$;

CREATE OR REPLACE FUNCTION app.connection_response_with_metadata(p_connection_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, app
AS $$
  SELECT jsonb_build_object(
    'id', a.id,
    'workspaceId', a.workspace_id,
    'connectorId', a.connector_id,
    'displayName', a.display_name,
    'status', a.status,
    'scopes', a.scopes,
    'lastSyncAt', a.last_sync_at,
    'lastError', a.last_error,
    'vaultRef', s.vault_ref,
    'metadata', a.metadata,
    'definition', jsonb_build_object(
      'id', d.id,
      'version', d.version,
      'displayName', d.display_name,
      'authType', d.auth_type,
      'capabilities', d.capabilities,
      'supports', d.supports,
      'storageModes', d.storage_modes
    )
  )
  FROM connector_accounts a
  JOIN connector_definitions d ON d.id = a.connector_id
  LEFT JOIN LATERAL (
    SELECT cs.vault_ref
    FROM connector_secrets cs
    WHERE cs.connector_account_id = a.id
      AND cs.workspace_id = a.workspace_id
      AND cs.key_purpose IN ('oauth_access', 'oauth_refresh')
    ORDER BY cs.updated_at DESC NULLS LAST
    LIMIT 1
  ) s ON true
  WHERE a.id = p_connection_id;
$$;

CREATE OR REPLACE FUNCTION app.api_list_connections(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
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
      app.connection_response_with_metadata(a.id)
      ORDER BY a.created_at
    )
    FROM connector_accounts a
    WHERE a.workspace_id = p_workspace_id
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION app.api_get_connection(
  p_secret text,
  p_subject_id uuid,
  p_connection_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_workspace_id uuid;
  v_row jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT workspace_id INTO v_workspace_id
  FROM connector_accounts
  WHERE id = p_connection_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT app.connection_response_with_metadata(p_connection_id) INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION app.api_upsert_connection(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_connector_id text,
  p_display_name text,
  p_scopes text[] DEFAULT '{}',
  p_status text DEFAULT 'connected',
  p_metadata jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_id uuid;
  v_status text := coalesce(nullif(btrim(p_status), ''), 'connected');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM connector_definitions WHERE id = p_connector_id
  ) THEN
    RAISE EXCEPTION 'unknown connector: %', p_connector_id;
  END IF;

  IF v_status NOT IN ('connected', 'degraded', 'reauth_required', 'revoked', 'disabled') THEN
    RAISE EXCEPTION 'invalid status: %', v_status;
  END IF;

  INSERT INTO connector_accounts (
    workspace_id, connector_id, display_name, status, scopes, last_sync_at, metadata, updated_at
  ) VALUES (
    p_workspace_id,
    p_connector_id,
    p_display_name,
    v_status,
    coalesce(p_scopes, '{}'),
    CASE WHEN v_status = 'connected' THEN now() ELSE NULL END,
    coalesce(v_metadata, '{}'::jsonb) || jsonb_build_object('updated_by', p_subject_id),
    now()
  )
  ON CONFLICT (workspace_id, connector_id, display_name) DO UPDATE
  SET
    status = EXCLUDED.status,
    scopes = EXCLUDED.scopes,
    last_sync_at = CASE
      WHEN EXCLUDED.status = 'connected' THEN now()
      ELSE connector_accounts.last_sync_at
    END,
    last_error = NULL,
    metadata = coalesce(connector_accounts.metadata, '{}'::jsonb)
      || coalesce(EXCLUDED.metadata, '{}'::jsonb)
      || jsonb_build_object('updated_by', p_subject_id),
    updated_at = now()
  RETURNING id INTO v_id;

  INSERT INTO audit_log (
    workspace_id, actor_subject_id, action, object_type, object_id, after_state
  ) VALUES (
    p_workspace_id,
    p_subject_id,
    'connection.upsert',
    'connector_account',
    v_id,
    jsonb_build_object(
      'connector_id', p_connector_id,
      'display_name', p_display_name,
      'status', v_status,
      'metadata', coalesce(v_metadata, '{}'::jsonb)
    )
  );

  RETURN app.connection_response_with_metadata(v_id);
END;
$$;

DROP FUNCTION IF EXISTS public.api_upsert_connection(text, uuid, uuid, text, text, text[], text);
CREATE OR REPLACE FUNCTION public.api_upsert_connection(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_connector_id text,
  p_display_name text,
  p_scopes text[] DEFAULT '{}',
  p_status text DEFAULT 'connected',
  p_metadata jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_upsert_connection(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_connector_id,
    p_display_name,
    p_scopes,
    p_status,
    p_metadata
  );
$$;

CREATE OR REPLACE FUNCTION app.api_set_connection_metadata(
  p_secret text,
  p_subject_id uuid,
  p_connection_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_row connector_accounts%ROWTYPE;
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

  UPDATE connector_accounts
  SET
    metadata = coalesce(v_row.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
    updated_at = now()
  WHERE id = p_connection_id
  RETURNING * INTO v_row;

  INSERT INTO audit_log (
    workspace_id, actor_subject_id, action, object_type, object_id, after_state
  ) VALUES (
    v_row.workspace_id,
    p_subject_id,
    'connection.metadata',
    'connector_account',
    v_row.id,
    jsonb_build_object('metadata', v_row.metadata)
  );

  RETURN app.connection_response_with_metadata(v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_set_connection_metadata(
  p_secret text,
  p_subject_id uuid,
  p_connection_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_set_connection_metadata(
    p_secret,
    p_subject_id,
    p_connection_id,
    p_metadata
  );
$$;

CREATE OR REPLACE FUNCTION app.api_upsert_project_from_connector(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_provider text,
  p_connection_id uuid,
  p_collection_id text,
  p_external_id text DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_url text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_default_branch text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_project projects%ROWTYPE;
  v_repo jsonb;
  v_owner_hint text := app.slugify_project_value(nullif(split_part(coalesce(p_collection_id, ''), '/', 1), ''));
  v_repo_hint text := app.slugify_project_value(nullif(split_part(coalesce(p_collection_id, ''), '/', 2), ''));
  v_name_hint text := app.slugify_project_value(coalesce(nullif(p_name, ''), p_collection_id, 'project'));
  v_display_name text := coalesce(nullif(btrim(p_name), ''), nullif(btrim(p_collection_id), ''), 'Project');
  v_base_slug text;
  v_slug text;
  v_suffix integer := 1;
  v_aliases text[];
  v_event_id uuid;
  v_memory_id uuid;
  v_memory_title text;
  v_memory_content text;
  v_memory_metadata jsonb;
  v_repo_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_external_id text := nullif(btrim(coalesce(p_external_id, '')), '');
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_repo := jsonb_strip_nulls(jsonb_build_object(
    'provider', p_provider,
    'connection_id', p_connection_id,
    'collection_id', p_collection_id,
    'external_id', v_external_id,
    'name', v_display_name,
    'url', v_repo_url,
    'description', nullif(btrim(coalesce(p_description, '')), ''),
    'default_branch', nullif(btrim(coalesce(p_default_branch, '')), ''),
    'metadata', coalesce(p_metadata, '{}'::jsonb),
    'synced_at', now()
  ));

  SELECT *
  INTO v_project
  FROM projects p
  WHERE p.workspace_id = p_workspace_id
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(p.repositories, '[]'::jsonb)) repo
      WHERE coalesce(repo->>'provider', '') = p_provider
        AND (
          (v_repo_url IS NOT NULL AND repo->>'url' = v_repo_url)
          OR (v_external_id IS NOT NULL AND repo->>'external_id' = v_external_id)
          OR repo->>'collection_id' = p_collection_id
        )
    )
  ORDER BY p.updated_at DESC, p.created_at DESC
  LIMIT 1;

  IF v_project.id IS NULL THEN
    v_base_slug := CASE
      WHEN v_repo_hint <> 'project' THEN v_repo_hint
      WHEN v_name_hint <> 'project' THEN v_name_hint
      ELSE 'project'
    END;
    v_slug := v_base_slug;
    WHILE EXISTS (
      SELECT 1
      FROM projects
      WHERE workspace_id = p_workspace_id
        AND slug = v_slug
    ) LOOP
      v_suffix := v_suffix + 1;
      v_slug := v_base_slug || '-' || v_suffix::text;
    END LOOP;

    INSERT INTO projects (
      workspace_id,
      slug,
      name,
      status,
      aliases,
      repositories,
      metadata
    ) VALUES (
      p_workspace_id,
      v_slug,
      v_display_name,
      'active',
      ARRAY[
        lower(v_display_name),
        lower(coalesce(p_collection_id, ''))
      ]::text[],
      jsonb_build_array(v_repo),
      jsonb_build_object(
        'source', 'connector_discover',
        'provider', p_provider,
        'connection_id', p_connection_id
      )
    )
    RETURNING * INTO v_project;
  ELSE
    v_aliases := ARRAY(
      SELECT DISTINCT alias
      FROM unnest(
        coalesce(v_project.aliases, '{}'::text[])
        || ARRAY[
          lower(v_display_name),
          lower(coalesce(p_collection_id, ''))
        ]::text[]
      ) alias
      WHERE alias IS NOT NULL AND btrim(alias) <> ''
    );

    UPDATE projects
    SET
      name = CASE
        WHEN v_project.id = '44444444-4444-4444-8444-444444444401' THEN v_project.name
        ELSE v_display_name
      END,
      aliases = coalesce(v_aliases, v_project.aliases),
      repositories = app.merge_project_repositories(v_project.repositories, v_repo),
      metadata = coalesce(v_project.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'source', 'connector_discover',
          'provider', p_provider,
          'connection_id', p_connection_id,
          'last_connector_sync_at', now()
        ),
      updated_at = now()
    WHERE id = v_project.id
    RETURNING * INTO v_project;
  END IF;

  INSERT INTO acl_entries (
    workspace_id, subject_id, effect, resource_type, project_id, actions, sensitivity_max
  )
  SELECT p_workspace_id, s.id, 'allow', 'memory', v_project.id, ARRAY['read', 'write']::text[], 'internal'
  FROM subjects s
  WHERE s.workspace_id = p_workspace_id
    AND s.external_key IN ('chatgpt', 'cursor')
    AND NOT EXISTS (
      SELECT 1
      FROM acl_entries a
      WHERE a.workspace_id = p_workspace_id
        AND a.subject_id = s.id
        AND a.effect = 'allow'
        AND a.resource_type = 'memory'
        AND a.project_id = v_project.id
        AND a.actions = ARRAY['read', 'write']::text[]
        AND coalesce(a.sensitivity_max, '') = 'internal'
    );

  INSERT INTO acl_entries (
    workspace_id, subject_id, effect, resource_type, project_id, actions, sensitivity_max
  )
  SELECT p_workspace_id, s.id, 'allow', 'handoff', v_project.id, ARRAY['read', 'write']::text[], 'internal'
  FROM subjects s
  WHERE s.workspace_id = p_workspace_id
    AND s.external_key IN ('chatgpt', 'cursor')
    AND NOT EXISTS (
      SELECT 1
      FROM acl_entries a
      WHERE a.workspace_id = p_workspace_id
        AND a.subject_id = s.id
        AND a.effect = 'allow'
        AND a.resource_type = 'handoff'
        AND a.project_id = v_project.id
        AND a.actions = ARRAY['read', 'write']::text[]
        AND coalesce(a.sensitivity_max, '') = 'internal'
    );

  v_memory_title := format('Проект GitHub: %s', v_display_name);
  v_memory_content := concat_ws(E'\n',
    format('Проект: %s', v_display_name),
    CASE WHEN v_repo_url IS NULL THEN NULL ELSE format('URL: %s', v_repo_url) END,
    CASE
      WHEN p_description IS NULL OR btrim(p_description) = '' THEN NULL
      ELSE format('Описание: %s', p_description)
    END,
    CASE
      WHEN p_default_branch IS NULL OR btrim(p_default_branch) = '' THEN NULL
      ELSE format('Основная ветка: %s', p_default_branch)
    END,
    format('Коллекция: %s', coalesce(p_collection_id, v_display_name))
  );
  v_memory_metadata := jsonb_build_object(
    'project_seed', true,
    'provider', p_provider,
    'connection_id', p_connection_id,
    'collection_id', p_collection_id,
    'external_id', v_external_id,
    'url', v_repo_url,
    'default_branch', nullif(btrim(coalesce(p_default_branch, '')), ''),
    'description', nullif(btrim(coalesce(p_description, '')), '')
  );

  INSERT INTO source_events (
    workspace_id,
    project_id,
    connector_account_id,
    provider,
    event_type,
    idempotency_key,
    observed_at,
    sensitivity,
    storage_mode,
    payload,
    content_checksum,
    created_by_subject
  ) VALUES (
    p_workspace_id,
    v_project.id,
    p_connection_id,
    p_provider,
    'connector.project.seeded',
    format('connector-project/%s/%s/%s', p_provider, p_connection_id, p_collection_id),
    now(),
    'internal',
    'indexed',
    jsonb_build_object(
      'title', v_memory_title,
      'project', v_display_name,
      'url', v_repo_url,
      'description', p_description,
      'default_branch', p_default_branch,
      'metadata', v_memory_metadata
    ),
    encode(digest(convert_to(v_memory_content, 'UTF8'), 'sha256'), 'hex'),
    p_subject_id
  )
  ON CONFLICT (workspace_id, provider, idempotency_key) DO UPDATE
  SET
    project_id = EXCLUDED.project_id,
    connector_account_id = EXCLUDED.connector_account_id,
    observed_at = EXCLUDED.observed_at,
    payload = EXCLUDED.payload,
    content_checksum = EXCLUDED.content_checksum,
    created_by_subject = EXCLUDED.created_by_subject
  RETURNING id INTO v_event_id;

  SELECT id INTO v_memory_id
  FROM memory_records
  WHERE source_event_id = v_event_id
    AND memory_type = 'fact'
  LIMIT 1;

  IF v_memory_id IS NULL THEN
    INSERT INTO memory_records (
      workspace_id,
      project_id,
      memory_type,
      title,
      content,
      status,
      importance,
      confidence,
      sensitivity,
      observed_at,
      recorded_at,
      source_event_id,
      created_by_subject,
      metadata
    ) VALUES (
      p_workspace_id,
      v_project.id,
      'fact',
      v_memory_title,
      v_memory_content,
      'verified',
      0.92,
      0.98,
      'internal',
      now(),
      now(),
      v_event_id,
      p_subject_id,
      v_memory_metadata
    )
    RETURNING id INTO v_memory_id;
  ELSE
    UPDATE memory_records
    SET
      project_id = v_project.id,
      title = v_memory_title,
      content = v_memory_content,
      status = 'verified',
      importance = 0.92,
      confidence = 0.98,
      sensitivity = 'internal',
      observed_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || v_memory_metadata
    WHERE id = v_memory_id;
  END IF;

  RETURN jsonb_build_object(
    'projectId', v_project.id,
    'slug', v_project.slug,
    'name', v_project.name,
    'memoryId', v_memory_id,
    'collectionId', p_collection_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_upsert_project_from_connector(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_provider text,
  p_connection_id uuid,
  p_collection_id text,
  p_external_id text DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_url text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_default_branch text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_upsert_project_from_connector(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_provider,
    p_connection_id,
    p_collection_id,
    p_external_id,
    p_name,
    p_url,
    p_description,
    p_default_branch,
    p_metadata
  );
$$;

GRANT EXECUTE ON FUNCTION app.slugify_project_value(text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.merge_project_repositories(jsonb, jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.connection_response_with_metadata(uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_upsert_connection(text, uuid, uuid, text, text, text[], text, jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_upsert_connection(text, uuid, uuid, text, text, text[], text, jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_set_connection_metadata(text, uuid, uuid, jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_set_connection_metadata(text, uuid, uuid, jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_upsert_project_from_connector(
  text, uuid, uuid, text, uuid, text, text, text, text, text, text, jsonb
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_upsert_project_from_connector(
  text, uuid, uuid, text, uuid, text, text, text, text, text, text, jsonb
) TO anon, authenticated, service_role;
