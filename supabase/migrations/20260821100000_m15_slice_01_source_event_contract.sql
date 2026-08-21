-- M15 Slice 01: unified source-event ingestion contract (additive)

ALTER TABLE source_events
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_version text,
  ADD COLUMN IF NOT EXISTS change_state text NOT NULL DEFAULT 'upsert',
  ADD COLUMN IF NOT EXISTS ingestion_adapter text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS envelope_schema_version text NOT NULL DEFAULT '1.0';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_events_change_state_check'
  ) THEN
    ALTER TABLE source_events
      ADD CONSTRAINT source_events_change_state_check
      CHECK (change_state IN ('upsert', 'delete', 'revoke'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_events_ingestion_adapter_check'
  ) THEN
    ALTER TABLE source_events
      ADD CONSTRAINT source_events_ingestion_adapter_check
      CHECK (ingestion_adapter IN ('webhook', 'polling', 'agent', 'manual'));
  END IF;
END $$;

UPDATE source_events se
SET
  external_id = COALESCE(
    se.external_id,
    NULLIF(se.payload #>> '{source,external_id}', '')
  ),
  external_version = COALESCE(
    se.external_version,
    NULLIF(se.payload #>> '{source,external_version}', '')
  ),
  envelope_schema_version = COALESCE(
    NULLIF(se.payload #>> '{schema_version}', ''),
    se.envelope_schema_version,
    '1.0'
  )
WHERE se.external_id IS NULL
   OR se.external_version IS NULL
   OR se.envelope_schema_version = '1.0';

CREATE INDEX IF NOT EXISTS idx_source_events_external_identity
  ON source_events (workspace_id, provider, external_id, external_version);

CREATE UNIQUE INDEX IF NOT EXISTS ux_source_events_account_idempotency
  ON source_events (connector_account_id, idempotency_key)
  WHERE connector_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app.api_ingest_source_event(
  p_secret text,
  p_subject_id uuid,
  p_envelope jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_workspace_id uuid;
  v_project_id uuid;
  v_provider text;
  v_event_type text;
  v_idempotency_key text;
  v_observed_at timestamptz;
  v_sensitivity text;
  v_storage_mode text;
  v_checksum text;
  v_account_id uuid;
  v_external_id text;
  v_external_version text;
  v_change_state text;
  v_adapter text;
  v_schema_version text;
  v_event_id uuid;
  v_rowcount integer := 0;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  v_workspace_id := NULLIF(p_envelope ->> 'workspace_id', '')::uuid;
  v_project_id := NULLIF(p_envelope #>> '{scope,project_id}', '')::uuid;
  v_provider := NULLIF(btrim(p_envelope #>> '{source,provider}'), '');
  v_event_type := NULLIF(btrim(p_envelope ->> 'event_type'), '');
  v_idempotency_key := NULLIF(btrim(p_envelope ->> 'idempotency_key'), '');
  v_observed_at := COALESCE(
    NULLIF(p_envelope ->> 'observed_at', '')::timestamptz,
    now()
  );
  v_sensitivity := COALESCE(NULLIF(p_envelope #>> '{scope,sensitivity}', ''), 'internal');
  v_storage_mode := COALESCE(NULLIF(p_envelope #>> '{scope,storage_mode}', ''), 'reference');
  v_checksum := NULLIF(p_envelope #>> '{content,checksum}', '');
  v_account_id := NULLIF(p_envelope #>> '{source,account_id}', '')::uuid;
  v_external_id := NULLIF(p_envelope #>> '{source,external_id}', '');
  v_external_version := NULLIF(p_envelope #>> '{source,external_version}', '');
  v_change_state := COALESCE(NULLIF(p_envelope ->> 'change_state', ''), 'upsert');
  v_adapter := COALESCE(NULLIF(p_envelope ->> 'ingestion_adapter', ''), 'manual');
  v_schema_version := COALESCE(NULLIF(p_envelope ->> 'schema_version', ''), '1.1');

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id is required for source-event ingest';
  END IF;
  IF v_provider IS NULL OR v_event_type IS NULL OR v_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'provider, event_type, and idempotency_key are required';
  END IF;
  IF v_change_state NOT IN ('upsert', 'delete', 'revoke') THEN
    RAISE EXCEPTION 'invalid change_state';
  END IF;
  IF v_adapter NOT IN ('webhook', 'polling', 'agent', 'manual') THEN
    RAISE EXCEPTION 'invalid ingestion_adapter';
  END IF;

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
    created_by_subject,
    external_id,
    external_version,
    change_state,
    ingestion_adapter,
    envelope_schema_version
  ) VALUES (
    v_workspace_id,
    v_project_id,
    v_account_id,
    v_provider,
    v_event_type,
    v_idempotency_key,
    v_observed_at,
    v_sensitivity,
    v_storage_mode,
    p_envelope,
    v_checksum,
    p_subject_id,
    v_external_id,
    v_external_version,
    v_change_state,
    v_adapter,
    v_schema_version
  )
  ON CONFLICT (workspace_id, provider, idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;

  SELECT id INTO v_event_id
  FROM source_events
  WHERE workspace_id = v_workspace_id
    AND provider = v_provider
    AND idempotency_key = v_idempotency_key;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'failed to resolve source_event after ingest';
  END IF;

  RETURN jsonb_build_object(
    'eventId', v_event_id,
    'idempotent', (v_rowcount = 0),
    'changeState', v_change_state,
    'ingestionAdapter', v_adapter,
    'envelopeSchemaVersion', v_schema_version,
    'externalId', v_external_id,
    'externalVersion', v_external_version
  );
END;
$$;

GRANT EXECUTE ON FUNCTION app.api_ingest_source_event(text, uuid, jsonb) TO service_role;
