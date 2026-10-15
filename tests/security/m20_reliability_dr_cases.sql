\set ON_ERROR_STOP on

-- Exercise retry, stale-job dead-lettering, bounded replay/resync, token loss,
-- and explicit reauthentication on disposable data. The transaction is always
-- rolled back so the same drill can run against a restored copy as well.
BEGIN;

DO $$
DECLARE
  v_secret constant text := 'ci-ephemeral-secret';
  v_owner constant uuid := '33333333-3333-4333-8333-333333333301';
  v_workspace constant uuid := '11111111-1111-4111-8111-111111111111';
  v_connection constant uuid := '99999999-0000-4000-8000-000000000020';
  v_job constant uuid := '99999999-0000-4000-8000-000000000021';
  v_event constant uuid := '99999999-0000-4000-8000-000000000022';
  v_vault_ref constant text := 'vault:test/m20/reliability';
  v_result jsonb;
  v_attempt integer;
BEGIN
  INSERT INTO connector_accounts (
    id, workspace_id, connector_id, display_name, status, scopes, metadata
  ) VALUES (
    v_connection,
    v_workspace,
    'github',
    'M20.2 reliability drill',
    'connected',
    ARRAY['repositories.read'],
    '{"drill":"m20-s02-v1"}'::jsonb
  )
  ON CONFLICT (id) DO UPDATE
  SET status = 'connected',
      last_error = NULL,
      updated_at = now();

  INSERT INTO connector_secrets (
    workspace_id, connector_account_id, vault_ref, key_purpose, updated_at
  ) VALUES (
    v_workspace, v_connection, v_vault_ref, 'oauth_access', now()
  )
  ON CONFLICT (connector_account_id) DO UPDATE
  SET vault_ref = EXCLUDED.vault_ref,
      key_purpose = EXCLUDED.key_purpose,
      updated_at = now();

  INSERT INTO connector_vault_blobs (vault_ref, ciphertext, updated_at)
  VALUES (v_vault_ref, decode('bTIwLWRyaWxsLXRva2Vu', 'base64'), now())
  ON CONFLICT (vault_ref) DO UPDATE
  SET ciphertext = EXCLUDED.ciphertext,
      updated_at = now();

  INSERT INTO connector_cursors (
    account_id, stream, opaque_cursor, schema_version, updated_at
  ) VALUES (
    v_connection, 'events', '{"cursor":"opaque"}'::jsonb, '1.0', now()
  )
  ON CONFLICT (account_id, stream) DO UPDATE
  SET opaque_cursor = EXCLUDED.opaque_cursor,
      updated_at = now();

  INSERT INTO processing_jobs (
    id, workspace_id, job_type, status, idempotency_key, attempt, updated_at
  ) VALUES (
    v_job,
    v_workspace,
    'connector_sync',
    'queued',
    format('connector-sync/%s/m20-s02', v_connection),
    0,
    now() - interval '2 hours'
  )
  ON CONFLICT (id) DO UPDATE
  SET status = 'queued',
      error = NULL,
      attempt = 0,
      updated_at = now() - interval '2 hours';

  INSERT INTO outbox_events (
    id, workspace_id, aggregate_type, aggregate_id, event_type, payload,
    published_at, attempts, last_error
  ) VALUES (
    v_event,
    v_workspace,
    'connector_account',
    v_connection,
    'connector.sync.requested',
    jsonb_build_object(
      'connectionId', v_connection,
      'jobId', v_job,
      'idempotencyKey', format('connector-sync/%s/m20-s02', v_connection)
    ),
    NULL,
    0,
    NULL
  )
  ON CONFLICT (id) DO UPDATE
  SET payload = EXCLUDED.payload,
      published_at = NULL,
      attempts = 0,
      last_error = NULL;

  v_result := app.api_dead_letter_stale_jobs(
    v_secret, v_owner, v_workspace, 60
  );
  IF (v_result->>'deadLettered')::integer < 1 THEN
    RAISE EXCEPTION 'stale-job drill did not dead-letter work: %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM processing_jobs
    WHERE id = v_job AND status = 'dead_letter' AND attempt = 1
  ) THEN
    RAISE EXCEPTION 'stale connector job did not reach dead_letter';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM outbox_events
    WHERE id = v_event AND published_at IS NOT NULL AND attempts = 1
  ) THEN
    RAISE EXCEPTION 'dead-letter drill did not terminally reconcile outbox';
  END IF;

  v_result := app.api_replay_connector_sync(
    v_secret, v_owner, v_job, true
  );
  IF v_result->>'status' <> 'queued'
     OR (v_result->>'clearedCursorCount')::integer <> 1 THEN
    RAISE EXCEPTION 'dead-letter replay/resync failed: %', v_result;
  END IF;
  IF EXISTS (
    SELECT 1 FROM connector_cursors
    WHERE account_id = v_connection
  ) THEN
    RAISE EXCEPTION 'replay with resync did not clear connector cursor';
  END IF;

  SELECT attempt INTO v_attempt FROM processing_jobs WHERE id = v_job;
  v_result := app.api_retry_connector_sync(
    v_secret, v_owner, v_job, 'bounded outage retry'
  );
  IF v_result->>'status' <> 'queued'
     OR (v_result->>'attempt')::integer <> v_attempt + 1 THEN
    RAISE EXCEPTION 'bounded retry failed: %', v_result;
  END IF;

  DELETE FROM connector_vault_blobs WHERE vault_ref = v_vault_ref;
  v_result := app.api_reconcile_connector_readiness(
    v_secret, v_owner, v_workspace, true
  );
  IF NOT EXISTS (
    SELECT 1 FROM connector_accounts
    WHERE id = v_connection AND status = 'reauth_required'
  ) THEN
    RAISE EXCEPTION 'token loss did not fail closed to reauth_required: %', v_result;
  END IF;

  UPDATE processing_jobs
  SET updated_at = now() - interval '2 seconds'
  WHERE id = v_job;
  v_result := app.api_claim_connector_sync_jobs(
    v_secret, v_owner, v_workspace, 10, v_connection, 1000, 1000
  );
  IF (v_result->>'count')::integer <> 0 THEN
    RAISE EXCEPTION 'reauth_required connector was claimable without token: %', v_result;
  END IF;

  -- An authorized OAuth callback is the only recovery boundary: token material
  -- returns first, then the account is explicitly re-enabled.
  INSERT INTO connector_vault_blobs (vault_ref, ciphertext, updated_at)
  VALUES (v_vault_ref, decode('bTIwLWRyaWxsLXRva2VuLXJvdGF0ZWQ=', 'base64'), now());
  UPDATE connector_accounts
  SET status = 'connected', last_error = NULL, updated_at = now()
  WHERE id = v_connection;
  UPDATE processing_jobs
  SET updated_at = now() - interval '2 seconds'
  WHERE id = v_job;

  v_result := app.api_claim_connector_sync_jobs(
    v_secret, v_owner, v_workspace, 10, v_connection, 1000, 1000
  );
  IF (v_result->>'count')::integer <> 1 THEN
    RAISE EXCEPTION 'explicit token recovery did not restore bounded claims: %', v_result;
  END IF;

  v_result := app.api_complete_connector_sync(
    v_secret, v_owner, v_job, 'succeeded', NULL
  );
  IF v_result->>'status' <> 'succeeded' THEN
    RAISE EXCEPTION 'recovered connector job did not complete: %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM audit_log
    WHERE workspace_id = v_workspace
      AND actor_subject_id = v_owner
      AND action = 'connection.sync.replayed'
      AND object_id = v_connection
  ) THEN
    RAISE EXCEPTION 'replay audit event is missing';
  END IF;
END;
$$;

ROLLBACK;

\echo m20_reliability_dr_cases=pass
