CREATE OR REPLACE FUNCTION app.api_upsert_connection_collection_item(
  p_secret text,
  p_subject_id uuid,
  p_connection_id uuid,
  p_item jsonb,
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
  v_items jsonb;
  v_excluded jsonb;
  v_bindings jsonb;
  v_synced_at jsonb;
  v_discovered jsonb := to_jsonb(coalesce(p_discovered_at, now()));
  v_item_id text := nullif(btrim(coalesce(p_item->>'id', '')), '');
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
  v_synced_at := coalesce(v_collections->'synced_at', 'null'::jsonb);

  IF v_item_id IS NOT NULL THEN
    v_items := coalesce((
      SELECT jsonb_agg(existing.item)
      FROM jsonb_array_elements(v_items) AS existing(item)
      WHERE coalesce(existing.item->>'id', '') <> v_item_id
    ), '[]'::jsonb);
    v_items := v_items || jsonb_build_array(p_item);
  END IF;

  UPDATE connector_accounts
  SET
    metadata = coalesce(v_row.metadata, '{}'::jsonb) || jsonb_build_object(
      'collections',
      jsonb_build_object(
        'selection_mode', 'all',
        'excluded_ids', v_excluded,
        'items', v_items,
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

CREATE OR REPLACE FUNCTION public.api_upsert_connection_collection_item(
  p_secret text,
  p_subject_id uuid,
  p_connection_id uuid,
  p_item jsonb,
  p_project_bindings jsonb DEFAULT '{}'::jsonb,
  p_discovered_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_upsert_connection_collection_item(
    p_secret,
    p_subject_id,
    p_connection_id,
    p_item,
    p_project_bindings,
    p_discovered_at
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_upsert_connection_collection_item(
  text,
  uuid,
  uuid,
  jsonb,
  jsonb,
  timestamptz
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_upsert_connection_collection_item(
  text,
  uuid,
  uuid,
  jsonb,
  jsonb,
  timestamptz
) TO anon, authenticated, service_role;
