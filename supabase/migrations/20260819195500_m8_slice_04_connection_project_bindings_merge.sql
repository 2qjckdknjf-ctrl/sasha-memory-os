CREATE OR REPLACE FUNCTION app.api_merge_connection_project_bindings(
  p_secret text,
  p_subject_id uuid,
  p_connection_id uuid,
  p_project_bindings jsonb DEFAULT '{}'::jsonb
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
  v_excluded jsonb;
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
  v_excluded := CASE
    WHEN jsonb_typeof(v_collections->'excluded_ids') = 'array' THEN v_collections->'excluded_ids'
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
        'excluded_ids', v_excluded,
        'items', v_items,
        'discovered_at', v_discovered_at,
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

CREATE OR REPLACE FUNCTION public.api_merge_connection_project_bindings(
  p_secret text,
  p_subject_id uuid,
  p_connection_id uuid,
  p_project_bindings jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_merge_connection_project_bindings(
    p_secret,
    p_subject_id,
    p_connection_id,
    p_project_bindings
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_merge_connection_project_bindings(
  text,
  uuid,
  uuid,
  jsonb
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_merge_connection_project_bindings(
  text,
  uuid,
  uuid,
  jsonb
) TO anon, authenticated, service_role;
