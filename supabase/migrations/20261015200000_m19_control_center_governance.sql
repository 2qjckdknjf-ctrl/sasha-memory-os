-- M19: owner-facing Control Center governance queries and bounded controls.

CREATE OR REPLACE FUNCTION app.assert_workspace_owner(
  p_workspace_id uuid,
  p_subject_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app.connection_response_with_metadata(p_connection_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT jsonb_build_object(
    'id', a.id,
    'workspaceId', a.workspace_id,
    'connectorId', a.connector_id,
    'displayName', a.display_name,
    'status', a.status,
    'scopes', a.scopes,
    'lastSyncAt', a.last_sync_at,
    'lastError', a.last_error,
    'vaultRef', s.vault_ref,
    'metadata', a.metadata,
    'cursors', coalesce(c.cursors, '[]'::jsonb),
    'definition', jsonb_build_object(
      'id', d.id,
      'version', d.version,
      'displayName', d.display_name,
      'authType', d.auth_type,
      'capabilities', d.capabilities,
      'supports', d.supports,
      'storageModes', d.storage_modes
    )
  )
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
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'stream', cc.stream,
        'present', true,
        'schemaVersion', cc.schema_version,
        'updatedAt', cc.updated_at
      )
      ORDER BY cc.stream
    ) AS cursors
    FROM connector_cursors cc
    WHERE cc.account_id = a.id
  ) c ON true
  WHERE a.id = p_connection_id;
$$;

-- The original P0 RPC accepted any globally valid project UUID. Keep routing
-- corrections inside the memory's workspace before the ledger row is written.
CREATE OR REPLACE FUNCTION app.api_apply_project_routing_correction(
  p_secret text,
  p_actor_subject_id uuid,
  p_memory_id uuid,
  p_corrected_project_id uuid,
  p_classification text,
  p_reason text,
  p_source_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_memory memory_records%ROWTYPE;
  v_row project_routing_corrections%ROWTYPE;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_actor_subject_id);

  SELECT * INTO v_memory FROM memory_records WHERE id = p_memory_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'memory not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM app.assert_workspace_owner(v_memory.workspace_id, p_actor_subject_id);

  IF NOT EXISTS (
    SELECT 1
    FROM projects p
    WHERE p.id = p_corrected_project_id
      AND p.workspace_id = v_memory.workspace_id
  ) THEN
    RAISE EXCEPTION 'corrected project must belong to memory workspace'
      USING ERRCODE = '22023';
  END IF;

  IF p_classification NOT IN (
    'KEEP_AISTROYKA', 'MOVE_TO_MEMORY_OS', 'MOVE_TO_HIAIR', 'UNCLASSIFIED', 'REVIEW_REQUIRED'
  ) THEN
    RAISE EXCEPTION 'invalid classification' USING ERRCODE = '22023';
  END IF;

  INSERT INTO project_routing_corrections (
    workspace_id,
    memory_id,
    previous_project_id,
    corrected_project_id,
    classification,
    reason,
    source_evidence,
    actor_subject_id
  )
  VALUES (
    v_memory.workspace_id,
    p_memory_id,
    v_memory.project_id,
    p_corrected_project_id,
    p_classification,
    nullif(btrim(p_reason), ''),
    coalesce(p_source_evidence, '{}'::jsonb),
    p_actor_subject_id
  )
  ON CONFLICT (memory_id) DO UPDATE SET
    corrected_project_id = EXCLUDED.corrected_project_id,
    classification = EXCLUDED.classification,
    reason = EXCLUDED.reason,
    source_evidence = EXCLUDED.source_evidence,
    actor_subject_id = EXCLUDED.actor_subject_id
  RETURNING * INTO v_row;

  INSERT INTO audit_log (
    workspace_id,
    actor_subject_id,
    action,
    object_type,
    object_id,
    reason,
    before_state,
    after_state
  )
  VALUES (
    v_memory.workspace_id,
    p_actor_subject_id,
    'project_routing.correct',
    'memory',
    p_memory_id,
    p_reason,
    jsonb_build_object('projectId', v_memory.project_id),
    jsonb_build_object(
      'correctedProjectId', p_corrected_project_id,
      'classification', p_classification
    )
  );

  RETURN jsonb_build_object(
    'memoryId', v_row.memory_id,
    'previousProjectId', v_row.previous_project_id,
    'correctedProjectId', v_row.corrected_project_id,
    'classification', v_row.classification
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.api_control_center_overview(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_latest_memory timestamptz;
  v_latest_source_event timestamptz;
  v_latest_sync timestamptz;
  v_newest timestamptz;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);
  PERFORM app.assert_workspace_owner(p_workspace_id, p_subject_id);

  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id AND p.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT max(m.recorded_at)
  INTO v_latest_memory
  FROM memory_records m
  WHERE m.workspace_id = p_workspace_id
    AND (p_project_id IS NULL OR app.effective_memory_project_id(m.id) = p_project_id);

  SELECT max(se.recorded_at)
  INTO v_latest_source_event
  FROM source_events se
  WHERE se.workspace_id = p_workspace_id
    AND (p_project_id IS NULL OR se.project_id = p_project_id);

  SELECT max(a.last_sync_at)
  INTO v_latest_sync
  FROM connector_accounts a
  WHERE a.workspace_id = p_workspace_id;

  SELECT max(ts)
  INTO v_newest
  FROM unnest(ARRAY[v_latest_memory, v_latest_source_event, v_latest_sync]) AS ts;

  RETURN jsonb_build_object(
    'workspaceId', p_workspace_id,
    'projectId', p_project_id,
    'generatedAt', now(),
    'freshness', jsonb_build_object(
      'status', CASE
        WHEN v_newest IS NULL THEN 'unknown'
        WHEN v_newest < now() - interval '24 hours' THEN 'stale'
        ELSE 'fresh'
      END,
      'newestRecordedAt', v_newest,
      'latestMemoryAt', v_latest_memory,
      'latestSourceEventAt', v_latest_source_event,
      'latestConnectorSyncAt', v_latest_sync,
      'slaSeconds', 86400
    ),
    'projects', jsonb_build_object(
      'total', (SELECT count(*) FROM projects p WHERE p.workspace_id = p_workspace_id),
      'withState', (
        SELECT count(DISTINCT ps.project_id)
        FROM project_state_versions ps
        JOIN projects p ON p.id = ps.project_id
        WHERE p.workspace_id = p_workspace_id
      )
    ),
    'memories', jsonb_build_object(
      'total', (
        SELECT count(*) FROM memory_records m
        WHERE m.workspace_id = p_workspace_id
          AND (p_project_id IS NULL OR app.effective_memory_project_id(m.id) = p_project_id)
      ),
      'candidate', (
        SELECT count(*) FROM memory_records m
        WHERE m.workspace_id = p_workspace_id
          AND m.status = 'candidate'
          AND (p_project_id IS NULL OR app.effective_memory_project_id(m.id) = p_project_id)
      ),
      'disputed', (
        SELECT count(*) FROM memory_records m
        WHERE m.workspace_id = p_workspace_id
          AND m.status = 'disputed'
          AND (p_project_id IS NULL OR app.effective_memory_project_id(m.id) = p_project_id)
      )
    ),
    'routing', jsonb_build_object(
      'unclassified', (
        SELECT count(*)
        FROM project_routing_corrections prc
        WHERE prc.workspace_id = p_workspace_id
          AND prc.classification IN ('UNCLASSIFIED', 'REVIEW_REQUIRED')
      )
    ),
    'connections', jsonb_build_object(
      'total', (SELECT count(*) FROM connector_accounts a WHERE a.workspace_id = p_workspace_id),
      'needsAttention', (
        SELECT count(*) FROM connector_accounts a
        WHERE a.workspace_id = p_workspace_id
          AND (a.status IN ('degraded', 'reauth_required') OR a.last_error IS NOT NULL)
      ),
      'revoked', (
        SELECT count(*) FROM connector_accounts a
        WHERE a.workspace_id = p_workspace_id AND a.status = 'revoked'
      )
    ),
    'jobs', jsonb_build_object(
      'queued', (
        SELECT count(*) FROM processing_jobs j
        WHERE j.workspace_id = p_workspace_id AND j.status = 'queued'
      ),
      'running', (
        SELECT count(*) FROM processing_jobs j
        WHERE j.workspace_id = p_workspace_id AND j.status = 'running'
      ),
      'failed', (
        SELECT count(*) FROM processing_jobs j
        WHERE j.workspace_id = p_workspace_id AND j.status = 'failed'
      ),
      'deadLetter', (
        SELECT count(*) FROM processing_jobs j
        WHERE j.workspace_id = p_workspace_id AND j.status = 'dead_letter'
      )
    ),
    'outbox', jsonb_build_object(
      'pending', (
        SELECT count(*) FROM outbox_events oe
        WHERE oe.workspace_id = p_workspace_id AND oe.published_at IS NULL
      )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.api_list_unclassified_memories(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);
  PERFORM app.assert_workspace_owner(p_workspace_id, p_subject_id);

  RETURN jsonb_build_object(
    'count', (
      SELECT count(*)
      FROM project_routing_corrections prc
      WHERE prc.workspace_id = p_workspace_id
        AND prc.classification IN ('UNCLASSIFIED', 'REVIEW_REQUIRED')
    ),
    'items', coalesce((
      SELECT jsonb_agg(row_value ORDER BY row_value->>'recordedAt' DESC)
      FROM (
        SELECT jsonb_build_object(
          'memoryId', m.id,
          'title', m.title,
          'memoryType', m.memory_type,
          'status', m.status,
          'sensitivity', m.sensitivity,
          'recordedAt', m.recorded_at,
          'sourceEventId', m.source_event_id,
          'previousProjectId', prc.previous_project_id,
          'proposedProjectId', prc.corrected_project_id,
          'classification', prc.classification,
          'reason', prc.reason,
          'sourceEvidence', prc.source_evidence
        ) AS row_value
        FROM project_routing_corrections prc
        JOIN memory_records m ON m.id = prc.memory_id
        WHERE prc.workspace_id = p_workspace_id
          AND prc.classification IN ('UNCLASSIFIED', 'REVIEW_REQUIRED')
        ORDER BY m.recorded_at DESC
        LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
      ) rows
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.api_list_processing_jobs(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_statuses text[] DEFAULT ARRAY['queued', 'running', 'failed', 'dead_letter'],
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);
  PERFORM app.assert_workspace_owner(p_workspace_id, p_subject_id);

  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(p_statuses, '{}'::text[])) AS requested(status)
    WHERE requested.status NOT IN ('queued', 'running', 'succeeded', 'failed', 'dead_letter')
  ) THEN
    RAISE EXCEPTION 'invalid job status';
  END IF;

  RETURN jsonb_build_object(
    'count', (
      SELECT count(*) FROM processing_jobs j
      WHERE j.workspace_id = p_workspace_id
        AND (coalesce(cardinality(p_statuses), 0) = 0 OR j.status = ANY(p_statuses))
    ),
    'jobs', coalesce((
      SELECT jsonb_agg(row_value ORDER BY row_value->>'updatedAt' DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', j.id,
          'jobType', j.job_type,
          'status', j.status,
          'attempt', j.attempt,
          'error', j.error,
          'createdAt', j.created_at,
          'updatedAt', j.updated_at,
          'connectionId', coalesce(
            nullif(oe.payload->>'connectionId', ''),
            CASE
              WHEN j.idempotency_key LIKE 'connector-sync/%'
                THEN split_part(j.idempotency_key, '/', 2)
              ELSE NULL
            END
          )
        ) AS row_value
        FROM processing_jobs j
        LEFT JOIN LATERAL (
          SELECT o.payload
          FROM outbox_events o
          WHERE o.workspace_id = j.workspace_id
            AND o.payload->>'jobId' = j.id::text
          ORDER BY o.created_at DESC
          LIMIT 1
        ) oe ON true
        WHERE j.workspace_id = p_workspace_id
          AND (coalesce(cardinality(p_statuses), 0) = 0 OR j.status = ANY(p_statuses))
        ORDER BY j.updated_at DESC
        LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
      ) rows
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_control_center_overview(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_control_center_overview(
    p_secret, p_subject_id, p_workspace_id, p_project_id
  );
$$;

CREATE OR REPLACE FUNCTION public.api_list_unclassified_memories(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_list_unclassified_memories(
    p_secret, p_subject_id, p_workspace_id, p_limit
  );
$$;

CREATE OR REPLACE FUNCTION public.api_list_processing_jobs(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_statuses text[] DEFAULT ARRAY['queued', 'running', 'failed', 'dead_letter'],
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_list_processing_jobs(
    p_secret, p_subject_id, p_workspace_id, p_statuses, p_limit
  );
$$;

REVOKE ALL ON FUNCTION app.assert_workspace_owner(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.connection_response_with_metadata(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.api_control_center_overview(text, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_control_center_overview(text, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.api_list_unclassified_memories(text, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_list_unclassified_memories(text, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.api_list_processing_jobs(text, uuid, uuid, text[], integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_list_processing_jobs(text, uuid, uuid, text[], integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION app.api_control_center_overview(text, uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.api_control_center_overview(text, uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION app.api_list_unclassified_memories(text, uuid, uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.api_list_unclassified_memories(text, uuid, uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION app.api_list_processing_jobs(text, uuid, uuid, text[], integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.api_list_processing_jobs(text, uuid, uuid, text[], integer)
  TO service_role;
