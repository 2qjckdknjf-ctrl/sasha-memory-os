CREATE OR REPLACE FUNCTION app.api_tombstone_connector_object(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_account_id text DEFAULT NULL,
  p_external_id text DEFAULT NULL,
  p_event_type text DEFAULT 'connector.object.deleted',
  p_observed_at timestamptz DEFAULT now(),
  p_idempotency_key text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_provenance jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_provider text := nullif(btrim(coalesce(p_provider, '')), '');
  v_account_id text := nullif(btrim(coalesce(p_account_id, '')), '');
  v_external_id text := nullif(btrim(coalesce(p_external_id, '')), '');
  v_event_type text := coalesce(nullif(btrim(coalesce(p_event_type, '')), ''), 'connector.object.deleted');
  v_idempotency_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_owner boolean := false;
  v_event_id uuid;
  v_project_id uuid := p_project_id;
  v_sensitivity text := 'internal';
  v_affected_ids uuid[] := '{}'::uuid[];
  v_affected_count integer := 0;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'provider required';
  END IF;
  IF v_external_id IS NULL THEN
    RAISE EXCEPTION 'external_id required';
  END IF;
  IF v_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key required';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason required';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) INTO v_owner;

  IF NOT v_owner THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH matched AS (
    SELECT
      m.id,
      m.project_id,
      m.sensitivity
    FROM memory_records m
    JOIN source_events s
      ON s.id = m.source_event_id
     AND s.workspace_id = m.workspace_id
    WHERE m.workspace_id = p_workspace_id
      AND s.provider = v_provider
      AND coalesce(s.payload->'source'->>'external_id', '') = v_external_id
      AND (
        v_account_id IS NULL
        OR coalesce(s.payload->'source'->>'account_id', '') = v_account_id
      )
      AND m.status <> 'deleted'
    FOR UPDATE OF m
  ),
  updated AS (
    UPDATE memory_records m
    SET
      status = 'deleted',
      valid_to = coalesce(m.valid_to, coalesce(p_observed_at, now())),
      metadata = coalesce(m.metadata, '{}'::jsonb) || jsonb_build_object(
        'status_reason', v_reason,
        'status_actor', p_subject_id,
        'status_at', now(),
        'connector_tombstone', jsonb_strip_nulls(jsonb_build_object(
          'provider', v_provider,
          'account_id', v_account_id,
          'external_id', v_external_id,
          'event_type', v_event_type
        ))
      )
    FROM matched
    WHERE m.id = matched.id
    RETURNING m.id, matched.project_id, matched.sensitivity
  )
  SELECT
    coalesce(array_agg(id), '{}'::uuid[]),
    count(*),
    coalesce(
      (array_agg(project_id) FILTER (WHERE project_id IS NOT NULL))[1],
      p_project_id
    ),
    coalesce((array_agg(sensitivity))[1], 'internal')
  INTO
    v_affected_ids,
    v_affected_count,
    v_project_id,
    v_sensitivity
  FROM updated;

  IF v_project_id IS NOT NULL OR v_affected_count > 0 THEN
    INSERT INTO source_events (
      workspace_id,
      project_id,
      provider,
      event_type,
      idempotency_key,
      observed_at,
      sensitivity,
      storage_mode,
      payload,
      created_by_subject
    ) VALUES (
      p_workspace_id,
      v_project_id,
      v_provider,
      v_event_type,
      v_idempotency_key,
      coalesce(p_observed_at, now()),
      v_sensitivity,
      'reference',
      jsonb_strip_nulls(jsonb_build_object(
        'schema_version', '1.0',
        'source', jsonb_strip_nulls(jsonb_build_object(
          'provider', v_provider,
          'account_id', v_account_id,
          'external_id', v_external_id
        )),
        'event_type', v_event_type,
        'reason', v_reason,
        'provenance', coalesce(p_provenance, '{}'::jsonb),
        'metadata', coalesce(p_metadata, '{}'::jsonb),
        'tombstone', true
      )),
      p_subject_id
    )
    ON CONFLICT (workspace_id, provider, idempotency_key) DO NOTHING;

    SELECT id INTO v_event_id
    FROM source_events
    WHERE workspace_id = p_workspace_id
      AND provider = v_provider
      AND idempotency_key = v_idempotency_key;
  ELSE
    v_event_id := NULL;
  END IF;

  INSERT INTO audit_log (
    workspace_id,
    actor_subject_id,
    action,
    object_type,
    object_id,
    reason,
    after_state
  ) VALUES (
    p_workspace_id,
    p_subject_id,
    'connector.object.tombstone',
    'connector_object',
    coalesce(v_external_id, v_provider),
    v_reason,
    jsonb_build_object(
      'provider', v_provider,
      'accountId', v_account_id,
      'externalId', v_external_id,
      'eventId', v_event_id,
      'projectId', v_project_id,
      'affectedCount', v_affected_count,
      'affectedMemoryIds', coalesce(to_jsonb(v_affected_ids), '[]'::jsonb)
    )
  );

  RETURN jsonb_build_object(
    'eventId', v_event_id,
    'affectedMemoryIds', coalesce(to_jsonb(v_affected_ids), '[]'::jsonb),
    'affectedCount', v_affected_count,
    'status', 'deleted',
    'provider', v_provider,
    'externalId', v_external_id,
    'reason', v_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_tombstone_connector_object(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_account_id text DEFAULT NULL,
  p_external_id text DEFAULT NULL,
  p_event_type text DEFAULT 'connector.object.deleted',
  p_observed_at timestamptz DEFAULT now(),
  p_idempotency_key text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_provenance jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_tombstone_connector_object(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_project_id,
    p_provider,
    p_account_id,
    p_external_id,
    p_event_type,
    p_observed_at,
    p_idempotency_key,
    p_reason,
    p_provenance,
    p_metadata
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_tombstone_connector_object(
  text,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  jsonb,
  jsonb
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.api_tombstone_connector_object(
  text,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  jsonb,
  jsonb
) TO anon, authenticated, service_role;
