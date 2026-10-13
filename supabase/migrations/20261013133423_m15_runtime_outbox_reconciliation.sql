-- M15 production runtime recovery: fail-closed connector readiness and bounded
-- reconciliation of internal outbox events whose processing jobs are terminal.

CREATE OR REPLACE FUNCTION app.api_reconcile_connector_readiness(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_apply_missing_token_status boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, vault, extensions
AS $$
DECLARE
  v_changed integer := 0;
  v_changed_ids jsonb := '[]'::jsonb;
  v_connections jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_ready integer := 0;
  v_reauth_required integer := 0;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_apply_missing_token_status THEN
    WITH material AS (
      SELECT
        a.id,
        a.status AS previous_status,
        cs.vault_ref,
        (
          EXISTS (
            SELECT 1
            FROM connector_vault_blobs b
            WHERE b.vault_ref = cs.vault_ref
          )
          OR EXISTS (
            SELECT 1
            FROM vault.secrets s
            WHERE s.name = cs.vault_ref
          )
        ) AS token_material_present
      FROM connector_accounts a
      LEFT JOIN connector_secrets cs
        ON cs.connector_account_id = a.id
       AND cs.workspace_id = a.workspace_id
      WHERE a.workspace_id = p_workspace_id
        AND a.status NOT IN ('revoked', 'disabled')
    ),
    updated AS (
      UPDATE connector_accounts a
      SET
        status = 'reauth_required',
        last_error = 'OAuth token material missing from configured vault; reconnect required',
        updated_at = now()
      FROM material m
      WHERE a.id = m.id
        AND m.token_material_present = false
        AND (
          a.status <> 'reauth_required'
          OR a.last_error IS DISTINCT FROM
            'OAuth token material missing from configured vault; reconnect required'
        )
      RETURNING a.id, m.previous_status
    )
    SELECT
      count(*)::integer,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'connectionId', id,
            'previousStatus', previous_status,
            'status', 'reauth_required'
          )
          ORDER BY id
        ),
        '[]'::jsonb
      )
    INTO v_changed, v_changed_ids
    FROM updated;

    IF v_changed > 0 THEN
      INSERT INTO audit_log (
        workspace_id,
        actor_subject_id,
        action,
        object_type,
        reason,
        after_state
      ) VALUES (
        p_workspace_id,
        p_subject_id,
        'connections.readiness.reconciled',
        'connector_accounts',
        'missing OAuth token material cannot be treated as connected',
        jsonb_build_object(
          'changed', v_changed,
          'connections', v_changed_ids
        )
      );
    END IF;
  END IF;

  WITH material AS (
    SELECT
      a.id,
      a.connector_id,
      a.display_name,
      a.status,
      a.last_sync_at,
      a.last_error,
      (cs.vault_ref IS NOT NULL) AS has_vault_ref,
      (
        cs.vault_ref IS NOT NULL
        AND (
          EXISTS (
            SELECT 1
            FROM connector_vault_blobs b
            WHERE b.vault_ref = cs.vault_ref
          )
          OR EXISTS (
            SELECT 1
            FROM vault.secrets s
            WHERE s.name = cs.vault_ref
          )
        )
      ) AS token_material_present,
      CASE
        WHEN jsonb_typeof(a.metadata #> '{collections,items}') = 'array'
          THEN jsonb_array_length(a.metadata #> '{collections,items}')
        ELSE 0
      END AS collection_count,
      CASE
        WHEN jsonb_typeof(a.metadata #> '{collections,excluded_ids}') = 'array'
          THEN jsonb_array_length(a.metadata #> '{collections,excluded_ids}')
        ELSE 0
      END AS excluded_collection_count
    FROM connector_accounts a
    LEFT JOIN connector_secrets cs
      ON cs.connector_account_id = a.id
     AND cs.workspace_id = a.workspace_id
    WHERE a.workspace_id = p_workspace_id
  ),
  report AS (
    SELECT
      m.*,
      (m.status = 'connected' AND m.token_material_present) AS ready_for_sync,
      CASE
        WHEN m.status = 'revoked' THEN 'revoked'
        WHEN m.status = 'disabled' THEN 'disabled'
        WHEN NOT m.has_vault_ref THEN 'missing_vault_ref'
        WHEN NOT m.token_material_present THEN 'missing_vault_material'
        WHEN m.status <> 'connected' THEN format('status_%s', m.status)
        ELSE 'ready'
      END AS readiness_reason
    FROM material m
  )
  SELECT
    count(*)::integer,
    (count(*) FILTER (WHERE ready_for_sync))::integer,
    (count(*) FILTER (WHERE status = 'reauth_required'))::integer,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'connectionId', id,
          'connectorId', connector_id,
          'displayName', display_name,
          'status', status,
          'lastSyncAt', last_sync_at,
          'lastError', last_error,
          'hasVaultRef', has_vault_ref,
          'tokenMaterialPresent', token_material_present,
          'readyForSync', ready_for_sync,
          'reason', readiness_reason,
          'collectionCount', collection_count,
          'selectedCollectionCount', greatest(
            collection_count - excluded_collection_count,
            0
          )
        )
        ORDER BY connector_id, display_name, id
      ),
      '[]'::jsonb
    )
  INTO v_total, v_ready, v_reauth_required, v_connections
  FROM report;

  RETURN jsonb_build_object(
    'workspaceId', p_workspace_id,
    'total', v_total,
    'ready', v_ready,
    'reauthRequired', v_reauth_required,
    'changed', v_changed,
    'applied', p_apply_missing_token_status,
    'connections', v_connections
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_reconcile_connector_readiness(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_apply_missing_token_status boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, vault, extensions
AS $$
  SELECT app.api_reconcile_connector_readiness(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_apply_missing_token_status
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_reconcile_connector_readiness(text, uuid, uuid, boolean)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_reconcile_connector_readiness(text, uuid, uuid, boolean)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.api_reconcile_terminal_outbox(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_reconciled integer := 0;
  v_succeeded integer := 0;
  v_failed integer := 0;
  v_dead_letter integer := 0;
  v_event_types jsonb := '{}'::jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH eligible AS (
    SELECT
      o.id,
      o.event_type,
      j.status AS job_status,
      j.error AS job_error
    FROM outbox_events o
    JOIN processing_jobs j
      ON j.workspace_id = o.workspace_id
     AND j.id::text = coalesce(
       nullif(o.payload->>'jobId', ''),
       nullif(o.payload->>'job_id', ''),
       CASE
         WHEN o.aggregate_type = 'processing_job' THEN o.aggregate_id::text
         ELSE NULL
       END
     )
    WHERE o.workspace_id = p_workspace_id
      AND o.published_at IS NULL
      AND o.event_type IN (
        'capture.text.queued',
        'capture.document.queued',
        'ingest.succeeded'
      )
      AND (
        (
          o.event_type IN ('capture.text.queued', 'capture.document.queued')
          AND j.status IN ('succeeded', 'failed', 'dead_letter')
        )
        OR (o.event_type = 'ingest.succeeded' AND j.status = 'succeeded')
      )
    ORDER BY o.created_at, o.id
    LIMIT v_limit
    FOR UPDATE OF o SKIP LOCKED
  ),
  updated AS (
    UPDATE outbox_events o
    SET
      published_at = coalesce(o.published_at, now()),
      last_error = CASE
        WHEN e.job_status IN ('failed', 'dead_letter')
          THEN left(
            coalesce(e.job_error, format('linked job is %s', e.job_status)),
            2000
          )
        ELSE NULL
      END
    FROM eligible e
    WHERE o.id = e.id
    RETURNING o.id, e.event_type, e.job_status
  )
  SELECT
    count(*)::integer,
    (count(*) FILTER (WHERE job_status = 'succeeded'))::integer,
    (count(*) FILTER (WHERE job_status = 'failed'))::integer,
    (count(*) FILTER (WHERE job_status = 'dead_letter'))::integer,
    coalesce(
      (
        SELECT jsonb_object_agg(event_type, event_count ORDER BY event_type)
        FROM (
          SELECT event_type, count(*)::integer AS event_count
          FROM updated
          GROUP BY event_type
        ) counts
      ),
      '{}'::jsonb
    )
  INTO
    v_reconciled,
    v_succeeded,
    v_failed,
    v_dead_letter,
    v_event_types
  FROM updated;

  IF v_reconciled > 0 THEN
    INSERT INTO audit_log (
      workspace_id,
      actor_subject_id,
      action,
      object_type,
      reason,
      after_state
    ) VALUES (
      p_workspace_id,
      p_subject_id,
      'outbox.terminal.reconciled',
      'outbox_events',
      'linked processing jobs are terminal',
      jsonb_build_object(
        'reconciled', v_reconciled,
        'succeeded', v_succeeded,
        'failed', v_failed,
        'deadLetter', v_dead_letter,
        'eventTypes', v_event_types
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'workspaceId', p_workspace_id,
    'reconciled', v_reconciled,
    'succeeded', v_succeeded,
    'failed', v_failed,
    'deadLetter', v_dead_letter,
    'eventTypes', v_event_types,
    'limit', v_limit
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_reconcile_terminal_outbox(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
  SELECT app.api_reconcile_terminal_outbox(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_limit
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_reconcile_terminal_outbox(text, uuid, uuid, integer)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_reconcile_terminal_outbox(text, uuid, uuid, integer)
  TO anon, authenticated, service_role;

-- Repair the original camelCase-only outbox correlation so both historical
-- snake_case ingest events and current connector events are closed safely.
CREATE OR REPLACE FUNCTION app.api_dead_letter_stale_jobs(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_older_than_minutes integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_minutes integer := greatest(1, coalesce(p_older_than_minutes, 60));
  v_cutoff timestamptz := now() - make_interval(mins => v_minutes);
  v_count integer := 0;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH stale AS (
    SELECT id
    FROM processing_jobs
    WHERE workspace_id = p_workspace_id
      AND status IN ('queued', 'running')
      AND updated_at < v_cutoff
    FOR UPDATE SKIP LOCKED
  ),
  marked AS (
    UPDATE processing_jobs j
    SET
      status = 'dead_letter',
      error = coalesce(j.error, format('stale after %s minutes', v_minutes)),
      updated_at = now(),
      attempt = j.attempt + 1
    FROM stale
    WHERE j.id = stale.id
    RETURNING j.id
  ),
  outbox_mark AS (
    UPDATE outbox_events o
    SET
      attempts = o.attempts + 1,
      last_error = format('job dead_letter after %s minutes', v_minutes),
      published_at = coalesce(o.published_at, now())
    WHERE o.workspace_id = p_workspace_id
      AND o.published_at IS NULL
      AND coalesce(
        nullif(o.payload->>'jobId', ''),
        nullif(o.payload->>'job_id', '')
      ) IN (SELECT id::text FROM marked)
    RETURNING o.id
  )
  SELECT count(*)::integer INTO v_count FROM marked;

  RETURN jsonb_build_object(
    'deadLettered', v_count,
    'olderThanMinutes', v_minutes,
    'cutoff', v_cutoff
  );
END;
$$;
