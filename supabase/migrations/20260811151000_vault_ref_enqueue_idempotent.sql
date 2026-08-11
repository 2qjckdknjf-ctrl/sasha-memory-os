-- Expose vault_ref on connections; enqueue sync with vaultRef + idempotent outbox

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
    SELECT jsonb_agg(jsonb_build_object(
      'id', a.id,
      'connectorId', a.connector_id,
      'displayName', a.display_name,
      'status', a.status,
      'scopes', a.scopes,
      'lastSyncAt', a.last_sync_at,
      'lastError', a.last_error,
      'vaultRef', s.vault_ref,
      'definition', jsonb_build_object(
        'id', d.id,
        'displayName', d.display_name,
        'capabilities', d.capabilities
      )
    ) ORDER BY a.created_at)
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
    WHERE a.workspace_id = p_workspace_id
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION app.api_enqueue_connector_sync(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_connection_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_conn RECORD;
  v_job_id uuid;
  v_event_id uuid;
  v_enqueued jsonb := '[]'::jsonb;
  v_count int := 0;
  v_idem text;
  v_vault_ref text;
  v_inserted boolean;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_conn IN
    SELECT a.*
    FROM connector_accounts a
    WHERE a.workspace_id = p_workspace_id
      AND a.status = 'connected'
      AND (p_connection_id IS NULL OR a.id = p_connection_id)
  LOOP
    v_idem := format(
      'connector-sync/%s/%s',
      v_conn.id::text,
      to_char(timezone('utc', now()), 'YYYYMMDDHH24MI')
    );

    SELECT cs.vault_ref INTO v_vault_ref
    FROM connector_secrets cs
    WHERE cs.connector_account_id = v_conn.id
      AND cs.workspace_id = v_conn.workspace_id
      AND cs.key_purpose IN ('oauth_access', 'oauth_refresh')
    ORDER BY cs.updated_at DESC NULLS LAST
    LIMIT 1;

    INSERT INTO processing_jobs (
      workspace_id, job_type, status, idempotency_key
    ) VALUES (
      p_workspace_id,
      'connector_sync',
      'queued',
      v_idem
    )
    ON CONFLICT (workspace_id, job_type, idempotency_key) DO NOTHING
    RETURNING id INTO v_job_id;

    v_inserted := v_job_id IS NOT NULL;

    IF NOT v_inserted THEN
      SELECT id INTO v_job_id
      FROM processing_jobs
      WHERE workspace_id = p_workspace_id
        AND job_type = 'connector_sync'
        AND idempotency_key = v_idem;

      SELECT o.id INTO v_event_id
      FROM outbox_events o
      WHERE o.workspace_id = p_workspace_id
        AND o.event_type = 'connector.sync.requested'
        AND o.payload->>'idempotencyKey' = v_idem
      ORDER BY o.created_at DESC
      LIMIT 1;
    ELSE
      INSERT INTO outbox_events (
        workspace_id, aggregate_type, aggregate_id, event_type, payload
      ) VALUES (
        p_workspace_id,
        'connector_account',
        v_conn.id,
        'connector.sync.requested',
        jsonb_build_object(
          'connectionId', v_conn.id,
          'connectorId', v_conn.connector_id,
          'displayName', v_conn.display_name,
          'requestedBy', p_subject_id,
          'vaultRef', v_vault_ref,
          'jobId', v_job_id,
          'idempotencyKey', v_idem,
          'mode', CASE WHEN v_vault_ref IS NULL THEN 'stub' ELSE 'vault' END
        )
      )
      RETURNING id INTO v_event_id;
    END IF;

    v_enqueued := v_enqueued || jsonb_build_array(
      jsonb_build_object(
        'connectionId', v_conn.id,
        'connectorId', v_conn.connector_id,
        'displayName', v_conn.display_name,
        'vaultRef', v_vault_ref,
        'jobId', v_job_id,
        'eventId', v_event_id,
        'idempotencyKey', v_idem
      )
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'enqueued', v_enqueued,
    'count', v_count
  );
END;
$$;
