\set ON_ERROR_STOP on

-- M15 runtime recovery must never call missing vault references "connected",
-- and must only acknowledge outbox events whose linked jobs are terminal.
DO $$
DECLARE
  v_secret constant text := 'ci-ephemeral-secret';
  v_owner constant uuid := '33333333-3333-4333-8333-333333333301';
  v_workspace constant uuid := '11111111-1111-4111-8111-111111111111';
  v_project constant uuid := '44444444-4444-4444-8444-444444444402';
  v_missing_connection constant uuid := '99999999-0000-4000-8000-000000000001';
  v_ready_connection constant uuid := '99999999-0000-4000-8000-000000000002';
  v_ready_ref constant text := 'vault:test/m15/ready';
  v_missing_ref constant text := 'vault:test/m15/missing';
  v_capture jsonb;
  v_job_id uuid;
  v_readiness jsonb;
  v_reconciled jsonb;
  v_pending integer;
BEGIN
  INSERT INTO connector_accounts (
    id,
    workspace_id,
    connector_id,
    display_name,
    status,
    scopes,
    metadata
  ) VALUES
    (
      v_missing_connection,
      v_workspace,
      'github',
      'M15 missing token fixture',
      'connected',
      ARRAY['repositories.read'],
      '{}'::jsonb
    ),
    (
      v_ready_connection,
      v_workspace,
      'github',
      'M15 ready token fixture',
      'connected',
      ARRAY['repositories.read'],
      '{}'::jsonb
    )
  ON CONFLICT (id) DO UPDATE
  SET status = EXCLUDED.status,
      last_error = NULL,
      updated_at = now();

  INSERT INTO connector_secrets (
    workspace_id,
    connector_account_id,
    vault_ref,
    key_purpose,
    updated_at
  ) VALUES
    (v_workspace, v_missing_connection, v_missing_ref, 'oauth_access', now()),
    (v_workspace, v_ready_connection, v_ready_ref, 'oauth_access', now())
  ON CONFLICT (connector_account_id) DO UPDATE
  SET vault_ref = EXCLUDED.vault_ref,
      key_purpose = EXCLUDED.key_purpose,
      updated_at = now();

  INSERT INTO connector_vault_blobs (vault_ref, ciphertext, updated_at)
  VALUES (v_ready_ref, decode('dGVzdC10b2tlbg==', 'base64'), now())
  ON CONFLICT (vault_ref) DO UPDATE
  SET ciphertext = EXCLUDED.ciphertext,
      updated_at = now();

  v_readiness := app.api_reconcile_connector_readiness(
    v_secret,
    v_owner,
    v_workspace,
    true
  );

  IF (v_readiness->>'changed')::integer < 1 THEN
    RAISE EXCEPTION 'expected at least one connector readiness correction: %', v_readiness;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM connector_accounts
    WHERE id = v_missing_connection
      AND status = 'reauth_required'
      AND last_error LIKE 'OAuth token material missing%'
  ) THEN
    RAISE EXCEPTION 'missing-token connector was not marked reauth_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM connector_accounts
    WHERE id = v_ready_connection
      AND status = 'connected'
  ) THEN
    RAISE EXCEPTION 'ready connector should remain connected';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_readiness->'connections') item
    WHERE item->>'connectionId' = v_ready_connection::text
      AND (item->>'tokenMaterialPresent')::boolean
      AND (item->>'readyForSync')::boolean
  ) THEN
    RAISE EXCEPTION 'readiness report did not identify the vault-backed connector';
  END IF;

  v_capture := app.api_capture_text(
    v_secret,
    v_owner,
    v_workspace,
    v_project,
    'M15 terminal outbox fixture',
    'M15 terminal outbox reconciliation fixture',
    'm15-terminal-outbox-fixture',
    'internal',
    true
  );
  v_job_id := (v_capture->>'jobId')::uuid;

  SELECT count(*)::integer INTO v_pending
  FROM outbox_events
  WHERE workspace_id = v_workspace
    AND published_at IS NULL
    AND event_type IN ('capture.text.queued', 'ingest.succeeded')
    AND coalesce(
      nullif(payload->>'jobId', ''),
      nullif(payload->>'job_id', ''),
      CASE WHEN aggregate_type = 'processing_job' THEN aggregate_id::text END
    ) = v_job_id::text;

  IF v_pending <> 2 THEN
    RAISE EXCEPTION 'expected two pending ingest lifecycle events, found %', v_pending;
  END IF;

  v_reconciled := app.api_reconcile_terminal_outbox(
    v_secret,
    v_owner,
    v_workspace,
    200
  );

  IF (v_reconciled->>'reconciled')::integer < 2 THEN
    RAISE EXCEPTION 'expected terminal outbox reconciliation: %', v_reconciled;
  END IF;

  SELECT count(*)::integer INTO v_pending
  FROM outbox_events
  WHERE workspace_id = v_workspace
    AND published_at IS NULL
    AND coalesce(
      nullif(payload->>'jobId', ''),
      nullif(payload->>'job_id', ''),
      CASE WHEN aggregate_type = 'processing_job' THEN aggregate_id::text END
    ) = v_job_id::text;

  IF v_pending <> 0 THEN
    RAISE EXCEPTION 'terminal outbox events remain unpublished: %', v_pending;
  END IF;
END;
$$;
