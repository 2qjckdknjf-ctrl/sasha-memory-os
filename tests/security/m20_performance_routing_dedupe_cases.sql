\set ON_ERROR_STOP on

DO $$
DECLARE
  v_secret constant text := 'ci-ephemeral-secret';
  v_owner constant uuid := '33333333-3333-4333-8333-333333333301';
  v_workspace constant uuid := '11111111-1111-4111-8111-111111111111';
  v_project constant uuid := '44444444-4444-4444-8444-444444444402';
  v_idempotency constant text := 'm20-s03-routing-dedupe-load';
  v_event_id uuid;
  v_route jsonb;
  v_count integer;
BEGIN
  SELECT id INTO STRICT v_event_id
  FROM source_events
  WHERE workspace_id = v_workspace
    AND provider = 'manual'
    AND idempotency_key = v_idempotency;

  IF (SELECT project_id FROM source_events WHERE id = v_event_id) <> v_project THEN
    RAISE EXCEPTION 'capture was routed to the wrong project';
  END IF;

  SELECT count(*) INTO v_count FROM source_events
  WHERE workspace_id = v_workspace AND provider = 'manual'
    AND idempotency_key = v_idempotency;
  IF v_count <> 1 THEN RAISE EXCEPTION 'source event dedupe failed: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM artifacts WHERE source_event_id = v_event_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'artifact dedupe failed: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM processing_jobs
  WHERE workspace_id = v_workspace AND job_type = 'ingest'
    AND idempotency_key = v_idempotency;
  IF v_count <> 1 THEN RAISE EXCEPTION 'job dedupe failed: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM outbox_events
  WHERE aggregate_id = v_event_id AND event_type = 'capture.text.queued';
  IF v_count <> 1 THEN RAISE EXCEPTION 'outbox dedupe failed: %', v_count; END IF;

  FOR v_count IN 1..40 LOOP
    v_route := app.api_resolve_project_ref(
      v_secret, v_owner, v_workspace, v_project::text
    );
    IF (v_route->>'projectId')::uuid <> v_project
      OR (v_route->>'matchCount')::integer <> 1
    THEN
      RAISE EXCEPTION 'project routing precision failed: %', v_route;
    END IF;
  END LOOP;
END;
$$;

\echo m20_performance_routing_dedupe_cases=pass routes=40 precision=1.0
