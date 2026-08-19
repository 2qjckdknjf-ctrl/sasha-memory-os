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
  v_current_items jsonb;
  v_provider_items jsonb;
  v_excluded jsonb;
  v_bindings jsonb;
  v_synced_at jsonb;
  v_discovered jsonb := to_jsonb(coalesce(p_discovered_at, now()));
  v_previous_discovered_at timestamptz;
  v_items_to_store jsonb;
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
  v_current_items := CASE
    WHEN jsonb_typeof(v_collections->'items') = 'array' THEN v_collections->'items'
    ELSE '[]'::jsonb
  END;
  v_provider_items := CASE
    WHEN jsonb_typeof(p_items) = 'array' THEN p_items
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
  v_previous_discovered_at := nullif(v_collections->>'discovered_at', '')::timestamptz;

  v_items_to_store := (
    WITH provider_items AS (
      SELECT provider.item, provider.ordinality
      FROM jsonb_array_elements(v_provider_items) WITH ORDINALITY AS provider(item, ordinality)
    ),
    provider_ids AS (
      SELECT coalesce(item->>'id', '') AS id
      FROM provider_items
    ),
    retained_items AS (
      SELECT
        current.item,
        coalesce((SELECT max(ordinality) FROM provider_items), 0) + row_number() OVER () AS ordinality
      FROM jsonb_array_elements(v_current_items) AS current(item)
      WHERE coalesce(current.item->>'id', '') <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM provider_ids
          WHERE id = coalesce(current.item->>'id', '')
        )
        AND current.item->'metadata'->>'added_via' = 'webhook'
        AND (
          v_previous_discovered_at IS NULL
          OR (
            coalesce(current.item->'metadata'->>'added_at', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            AND (current.item->'metadata'->>'added_at')::timestamptz > v_previous_discovered_at
          )
        )
    ),
    merged_items AS (
      SELECT item, ordinality FROM provider_items
      UNION ALL
      SELECT item, ordinality FROM retained_items
    )
    SELECT coalesce(jsonb_agg(item ORDER BY ordinality), '[]'::jsonb)
    FROM merged_items
  );

  UPDATE connector_accounts
  SET
    metadata = coalesce(v_row.metadata, '{}'::jsonb) || jsonb_build_object(
      'collections',
      jsonb_build_object(
        'selection_mode', 'all',
        'excluded_ids', v_excluded,
        'items', v_items_to_store,
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
