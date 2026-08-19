-- M7 Control Center backend gaps: audit read, privacy requests, handoff history,
-- agent rights read, memory provenance, and audit logging for exports/handoffs/sync.

CREATE TABLE IF NOT EXISTS privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects (id) ON DELETE SET NULL,
  actor_subject_id uuid REFERENCES subjects (id) ON DELETE SET NULL,
  request_type text NOT NULL
    CHECK (request_type IN ('deletion', 'correction', 'retraction')),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted')),
  target_memory_id uuid REFERENCES memory_records (id) ON DELETE SET NULL,
  reason text NOT NULL,
  correction_text text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_workspace_created
  ON privacy_requests (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_target_memory
  ON privacy_requests (target_memory_id);

ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY privacy_requests_select ON privacy_requests
  FOR SELECT USING (app.is_workspace_member(workspace_id));

CREATE POLICY privacy_requests_insert ON privacy_requests
  FOR INSERT WITH CHECK (app.is_workspace_member(workspace_id));

CREATE POLICY privacy_requests_no_update ON privacy_requests
  FOR UPDATE USING (false);

CREATE POLICY privacy_requests_no_delete ON privacy_requests
  FOR DELETE USING (false);

CREATE OR REPLACE FUNCTION app.api_append_audit_event(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_action text,
  p_object_type text DEFAULT NULL,
  p_object_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_before_state jsonb DEFAULT NULL,
  p_after_state jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO audit_log (
    workspace_id,
    actor_subject_id,
    action,
    object_type,
    object_id,
    reason,
    before_state,
    after_state
  ) VALUES (
    p_workspace_id,
    p_subject_id,
    p_action,
    p_object_type,
    p_object_id,
    p_reason,
    p_before_state,
    p_after_state
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'action', p_action,
    'objectType', p_object_type,
    'objectId', p_object_id,
    'reason', p_reason,
    'recordedAt', (SELECT recorded_at FROM audit_log WHERE id = v_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_append_audit_event(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_action text,
  p_object_type text DEFAULT NULL,
  p_object_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_before_state jsonb DEFAULT NULL,
  p_after_state jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_append_audit_event(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_action,
    p_object_type,
    p_object_id,
    p_reason,
    p_before_state,
    p_after_state
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_append_audit_event(text, uuid, uuid, text, text, uuid, text, jsonb, jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_append_audit_event(text, uuid, uuid, text, text, uuid, text, jsonb, jsonb)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.api_list_audit(
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
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'events',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'workspaceId', a.workspace_id,
          'actorSubjectId', a.actor_subject_id,
          'actor', CASE
            WHEN s.id IS NULL THEN NULL
            ELSE jsonb_build_object(
              'id', s.id,
              'externalKey', s.external_key,
              'displayName', s.display_name,
              'kind', s.kind
            )
          END,
          'action', a.action,
          'objectType', a.object_type,
          'objectId', a.object_id,
          'reason', a.reason,
          'beforeState', a.before_state,
          'afterState', a.after_state,
          'recordedAt', a.recorded_at
        )
        ORDER BY a.recorded_at DESC
      )
      FROM (
        SELECT *
        FROM audit_log
        WHERE workspace_id = p_workspace_id
        ORDER BY recorded_at DESC
        LIMIT v_limit
      ) a
      LEFT JOIN subjects s ON s.id = a.actor_subject_id
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_list_audit(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_list_audit(p_secret, p_subject_id, p_workspace_id, p_limit);
$$;

GRANT EXECUTE ON FUNCTION app.api_list_audit(text, uuid, uuid, integer)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_list_audit(text, uuid, uuid, integer)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.api_list_handoffs(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'handoffs',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', h.id,
          'workspaceId', h.workspace_id,
          'projectId', h.project_id,
          'fromSubjectId', h.from_subject_id,
          'toSubjectId', h.to_subject_id,
          'sessionId', h.session_id,
          'payload', h.payload,
          'createdAt', h.created_at
        )
        ORDER BY h.created_at DESC
      )
      FROM (
        SELECT *
        FROM handoffs
        WHERE workspace_id = p_workspace_id
          AND (p_project_id IS NULL OR project_id = p_project_id)
          AND app.has_acl(workspace_id, 'handoff', 'read', project_id)
        ORDER BY created_at DESC
        LIMIT v_limit
      ) h
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_list_handoffs(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_list_handoffs(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_project_id,
    p_limit
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_list_handoffs(text, uuid, uuid, uuid, integer)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_list_handoffs(text, uuid, uuid, uuid, integer)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.api_create_privacy_request(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_request_type text DEFAULT 'deletion',
  p_target_memory_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_correction_text text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_id uuid;
  v_row privacy_requests%ROWTYPE;
  v_owner boolean;
  v_memory memory_records%ROWTYPE;
  v_project_id uuid := p_project_id;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

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

  IF p_request_type NOT IN ('deletion', 'correction', 'retraction') THEN
    RAISE EXCEPTION 'invalid privacy request type: %', p_request_type;
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason required';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency key required';
  END IF;

  IF p_target_memory_id IS NOT NULL THEN
    SELECT * INTO v_memory
    FROM memory_records
    WHERE id = p_target_memory_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'memory not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_memory.workspace_id <> p_workspace_id THEN
      RAISE EXCEPTION 'workspace mismatch';
    END IF;

    v_project_id := coalesce(v_project_id, v_memory.project_id);
  END IF;

  INSERT INTO privacy_requests (
    workspace_id,
    project_id,
    actor_subject_id,
    request_type,
    status,
    target_memory_id,
    reason,
    correction_text,
    idempotency_key
  ) VALUES (
    p_workspace_id,
    v_project_id,
    p_subject_id,
    p_request_type,
    'submitted',
    p_target_memory_id,
    btrim(p_reason),
    nullif(btrim(coalesce(p_correction_text, '')), ''),
    p_idempotency_key
  )
  ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM privacy_requests
    WHERE workspace_id = p_workspace_id
      AND idempotency_key = p_idempotency_key;
  END IF;

  INSERT INTO audit_log (
    workspace_id,
    actor_subject_id,
    action,
    object_type,
    object_id,
    reason,
    after_state
  )
  SELECT
    p_workspace_id,
    p_subject_id,
    'privacy.request.submitted',
    'privacy_request',
    v_id,
    btrim(p_reason),
    jsonb_build_object(
      'requestType', p_request_type,
      'targetMemoryId', p_target_memory_id,
      'projectId', v_project_id,
      'status', 'submitted'
    )
  WHERE NOT EXISTS (
    SELECT 1
    FROM audit_log a
    WHERE a.workspace_id = p_workspace_id
      AND a.object_type = 'privacy_request'
      AND a.object_id = v_id
      AND a.action = 'privacy.request.submitted'
  );

  SELECT * INTO v_row
  FROM privacy_requests
  WHERE id = v_id;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'workspaceId', v_row.workspace_id,
    'projectId', v_row.project_id,
    'actorSubjectId', v_row.actor_subject_id,
    'requestType', v_row.request_type,
    'status', v_row.status,
    'targetMemoryId', v_row.target_memory_id,
    'reason', v_row.reason,
    'correctionText', v_row.correction_text,
    'createdAt', v_row.created_at,
    'actor', (
      SELECT jsonb_build_object(
        'id', s.id,
        'externalKey', s.external_key,
        'displayName', s.display_name,
        'kind', s.kind
      )
      FROM subjects s
      WHERE s.id = v_row.actor_subject_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_create_privacy_request(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_request_type text DEFAULT 'deletion',
  p_target_memory_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_correction_text text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_create_privacy_request(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_project_id,
    p_request_type,
    p_target_memory_id,
    p_reason,
    p_correction_text,
    p_idempotency_key
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_create_privacy_request(text, uuid, uuid, uuid, text, uuid, text, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_create_privacy_request(text, uuid, uuid, uuid, text, uuid, text, text, text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.api_list_privacy_requests(
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
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT EXISTS (
    SELECT 1
    FROM workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'requests',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'workspaceId', r.workspace_id,
          'projectId', r.project_id,
          'actorSubjectId', r.actor_subject_id,
          'requestType', r.request_type,
          'status', r.status,
          'targetMemoryId', r.target_memory_id,
          'reason', r.reason,
          'correctionText', r.correction_text,
          'createdAt', r.created_at,
          'actor', CASE
            WHEN s.id IS NULL THEN NULL
            ELSE jsonb_build_object(
              'id', s.id,
              'externalKey', s.external_key,
              'displayName', s.display_name,
              'kind', s.kind
            )
          END
        )
        ORDER BY r.created_at DESC
      )
      FROM (
        SELECT *
        FROM privacy_requests
        WHERE workspace_id = p_workspace_id
        ORDER BY created_at DESC
        LIMIT v_limit
      ) r
      LEFT JOIN subjects s ON s.id = r.actor_subject_id
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_list_privacy_requests(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_list_privacy_requests(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_limit
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_list_privacy_requests(text, uuid, uuid, integer)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_list_privacy_requests(text, uuid, uuid, integer)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.api_list_agent_rights(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_current_actor jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'subjectId', s.id,
    'isOwner', EXISTS (
      SELECT 1
      FROM workspace_memberships wm
      WHERE wm.workspace_id = s.workspace_id
        AND wm.subject_id = s.id
        AND wm.role = 'owner'
    ),
    'actor', jsonb_build_object(
      'id', s.id,
      'externalKey', s.external_key,
      'displayName', s.display_name,
      'kind', s.kind
    )
  ) INTO v_current_actor
  FROM subjects s
  WHERE s.id = p_subject_id
    AND s.workspace_id = p_workspace_id;

  RETURN jsonb_build_object(
    'currentActor',
    v_current_actor,
    'actors',
    COALESCE((
      SELECT jsonb_agg(actor_row ORDER BY actor_order)
      FROM (
        SELECT
          CASE s.external_key
            WHEN 'owner' THEN 1
            WHEN 'chatgpt' THEN 2
            WHEN 'cursor' THEN 3
            ELSE 99
          END AS actor_order,
          jsonb_build_object(
            'subjectId', s.id,
            'externalKey', s.external_key,
            'displayName', s.display_name,
            'kind', s.kind,
            'isOwner', EXISTS (
              SELECT 1
              FROM workspace_memberships wm
              WHERE wm.workspace_id = s.workspace_id
                AND wm.subject_id = s.id
                AND wm.role = 'owner'
            ),
            'scopes', CASE
              WHEN EXISTS (
                SELECT 1
                FROM workspace_memberships wm
                WHERE wm.workspace_id = s.workspace_id
                  AND wm.subject_id = s.id
                  AND wm.role = 'owner'
              ) THEN to_jsonb(ARRAY[
                'workspace.owner',
                'memory.export',
                'connections.manage'
              ]::text[])
              ELSE COALESCE((
                SELECT to_jsonb(array_agg(
                  format(
                    '%s.%s@%s<=%s',
                    a.resource_type,
                    CASE
                      WHEN coalesce(array_length(a.actions, 1), 0) = 0 THEN 'all'
                      ELSE array_to_string(a.actions, '+')
                    END,
                    coalesce(a.project_id::text, 'workspace'),
                    coalesce(a.sensitivity_max, 'all')
                  )
                  ORDER BY a.resource_type, a.project_id
                ))
                FROM acl_entries a
                WHERE a.workspace_id = s.workspace_id
                  AND a.subject_id = s.id
                  AND a.effect = 'allow'
              ), '[]'::jsonb)
            END,
            'capabilities', coalesce(ag.capabilities, '[]'::jsonb),
            'rights', CASE
              WHEN EXISTS (
                SELECT 1
                FROM workspace_memberships wm
                WHERE wm.workspace_id = s.workspace_id
                  AND wm.subject_id = s.id
                  AND wm.role = 'owner'
              ) THEN jsonb_build_array(
                jsonb_build_object(
                  'effect', 'allow',
                  'resourceType', '*',
                  'projectId', NULL,
                  'actions', ARRAY['read', 'write'],
                  'sensitivityMax', NULL,
                  'source', 'workspace_owner'
                )
              )
              ELSE COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'effect', a.effect,
                    'resourceType', a.resource_type,
                    'projectId', a.project_id,
                    'actions', a.actions,
                    'sensitivityMax', a.sensitivity_max,
                    'source', 'acl'
                  )
                  ORDER BY a.resource_type, a.project_id
                )
                FROM acl_entries a
                WHERE a.workspace_id = s.workspace_id
                  AND a.subject_id = s.id
              ), '[]'::jsonb)
            END
          ) AS actor_row
        FROM subjects s
        LEFT JOIN agents ag
          ON ag.workspace_id = s.workspace_id
         AND ag.subject_id = s.id
        WHERE s.workspace_id = p_workspace_id
          AND s.external_key IN ('owner', 'chatgpt', 'cursor')
      ) rows
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_list_agent_rights(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_list_agent_rights(
    p_secret,
    p_subject_id,
    p_workspace_id
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_list_agent_rights(text, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_list_agent_rights(text, uuid, uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.api_create_handoff(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_to_subject_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.has_acl(p_workspace_id, 'handoff', 'write', p_project_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO handoffs (
    workspace_id, project_id, from_subject_id, to_subject_id, payload
  ) VALUES (
    p_workspace_id, p_project_id, p_subject_id, p_to_subject_id, p_payload
  )
  RETURNING id INTO v_id;

  INSERT INTO audit_log (
    workspace_id,
    actor_subject_id,
    action,
    object_type,
    object_id,
    after_state
  ) VALUES (
    p_workspace_id,
    p_subject_id,
    'handoff.create',
    'handoff',
    v_id,
    jsonb_build_object(
      'projectId', p_project_id,
      'fromSubjectId', p_subject_id,
      'toSubjectId', p_to_subject_id,
      'payload', p_payload
    )
  );

  RETURN (SELECT to_jsonb(h) FROM handoffs h WHERE h.id = v_id);
END;
$$;

CREATE OR REPLACE FUNCTION app.api_get_memory(
  p_secret text,
  p_subject_id uuid,
  p_memory_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_row memory_records%ROWTYPE;
  v_source jsonb := NULL;
  v_evidence jsonb := '[]'::jsonb;
  v_provenance jsonb := NULL;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT * INTO v_row
  FROM memory_records
  WHERE id = p_memory_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'memory not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member(v_row.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT app.has_acl(
    v_row.workspace_id,
    'memory',
    'read',
    v_row.project_id,
    v_row.sensitivity
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_strip_nulls(jsonb_build_object(
    'sourceEventId', se.id,
    'provider', se.provider,
    'eventType', se.event_type,
    'observedAt', se.observed_at,
    'recordedAt', se.recorded_at,
    'payload', CASE
      WHEN se.payload ? 'content' THEN se.payload - 'content'
      ELSE se.payload
    END
  )) INTO v_source
  FROM source_events se
  WHERE se.id = v_row.source_event_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'sourceEventId', me.source_event_id,
        'evidenceSpan', me.evidence_span,
        'artifact', CASE
          WHEN a.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', a.id,
            'mimeType', a.mime_type,
            'storageMode', a.storage_mode,
            'storageKey', a.storage_key,
            'checksumSha256', a.checksum_sha256,
            'byteSize', a.byte_size,
            'metadata', CASE
              WHEN a.metadata ? 'text' THEN a.metadata - 'text'
              ELSE a.metadata
            END
          )
        END
      ))
      ORDER BY me.source_event_id
    ),
    '[]'::jsonb
  ) INTO v_evidence
  FROM memory_evidence me
  LEFT JOIN artifacts a
    ON a.source_event_id = me.source_event_id
   AND a.workspace_id = me.workspace_id
  WHERE me.memory_id = v_row.id;

  SELECT jsonb_strip_nulls(jsonb_build_object(
    'origin', CASE
      WHEN v_row.source_event_id IS NULL THEN 'manual'
      ELSE 'source_event'
    END,
    'sourceEventId', v_row.source_event_id,
    'createdBySubject', v_row.created_by_subject,
    'revisionCount', (
      SELECT count(*)::integer
      FROM memory_revisions mr
      WHERE mr.memory_id = v_row.id
    ),
    'decisionRationale', (
      SELECT d.rationale
      FROM decisions d
      WHERE d.memory_id = v_row.id
      LIMIT 1
    ),
    'statusReason', v_row.metadata->>'status_reason'
  )) INTO v_provenance;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'title', v_row.title,
    'content', v_row.content,
    'status', v_row.status,
    'sensitivity', v_row.sensitivity,
    'memoryType', v_row.memory_type,
    'projectId', v_row.project_id,
    'workspaceId', v_row.workspace_id,
    'recordedAt', v_row.recorded_at,
    'observedAt', v_row.observed_at,
    'validFrom', v_row.valid_from,
    'validTo', v_row.valid_to,
    'sourceEventId', v_row.source_event_id,
    'createdBySubject', v_row.created_by_subject,
    'supersededBy', v_row.superseded_by,
    'importance', v_row.importance,
    'confidence', v_row.confidence,
    'schemaVersion', v_row.schema_version,
    'metadata', v_row.metadata,
    'embedding', v_row.embedding,
    'embeddingEngine', v_row.embedding_engine,
    'embeddingDims', v_row.embedding_dims,
    'source', v_source,
    'evidence', v_evidence,
    'provenance', v_provenance
  );
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

      INSERT INTO audit_log (
        workspace_id,
        actor_subject_id,
        action,
        object_type,
        object_id,
        after_state
      ) VALUES (
        p_workspace_id,
        p_subject_id,
        'connection.sync.requested',
        'connector_account',
        v_conn.id,
        jsonb_build_object(
          'connectionId', v_conn.id,
          'connectorId', v_conn.connector_id,
          'displayName', v_conn.display_name,
          'jobId', v_job_id,
          'idempotencyKey', v_idem,
          'vaultRef', v_vault_ref,
          'mode', CASE WHEN v_vault_ref IS NULL THEN 'stub' ELSE 'vault' END
        )
      );
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

CREATE OR REPLACE FUNCTION app.api_complete_connector_sync(
  p_secret text,
  p_subject_id uuid,
  p_job_id uuid,
  p_status text DEFAULT 'succeeded',
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_job processing_jobs%ROWTYPE;
  v_connection_id uuid;
  v_status text := coalesce(nullif(btrim(p_status), ''), 'succeeded');
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF v_status NOT IN ('succeeded', 'failed', 'dead_letter') THEN
    RAISE EXCEPTION 'invalid status: %', v_status;
  END IF;

  SELECT * INTO v_job
  FROM processing_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member(v_job.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_job.job_type <> 'connector_sync' THEN
    RAISE EXCEPTION 'job is not connector_sync';
  END IF;

  UPDATE processing_jobs
  SET
    status = v_status,
    error = CASE WHEN v_status = 'succeeded' THEN NULL ELSE coalesce(p_error, error) END,
    updated_at = now(),
    attempt = attempt + 1
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  SELECT (payload->>'connectionId')::uuid INTO v_connection_id
  FROM outbox_events
  WHERE workspace_id = v_job.workspace_id
    AND event_type = 'connector.sync.requested'
    AND payload->>'jobId' = v_job.id::text
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_connection_id IS NULL AND v_job.idempotency_key LIKE 'connector-sync/%' THEN
    v_connection_id := split_part(v_job.idempotency_key, '/', 2)::uuid;
  END IF;

  IF v_connection_id IS NOT NULL AND v_status = 'succeeded' THEN
    UPDATE connector_accounts
    SET
      last_sync_at = now(),
      last_error = NULL,
      status = CASE WHEN status = 'connected' THEN status ELSE 'connected' END,
      updated_at = now()
    WHERE id = v_connection_id
      AND workspace_id = v_job.workspace_id;
  ELSIF v_connection_id IS NOT NULL AND v_status <> 'succeeded' THEN
    UPDATE connector_accounts
    SET
      last_error = coalesce(p_error, 'connector sync failed'),
      status = 'degraded',
      updated_at = now()
    WHERE id = v_connection_id
      AND workspace_id = v_job.workspace_id;
  END IF;

  UPDATE outbox_events
  SET published_at = coalesce(published_at, now())
  WHERE workspace_id = v_job.workspace_id
    AND event_type = 'connector.sync.requested'
    AND payload->>'jobId' = v_job.id::text
    AND published_at IS NULL;

  INSERT INTO audit_log (
    workspace_id,
    actor_subject_id,
    action,
    object_type,
    object_id,
    reason,
    after_state
  ) VALUES (
    v_job.workspace_id,
    p_subject_id,
    'connection.sync.completed',
    CASE WHEN v_connection_id IS NULL THEN 'connector_sync_job' ELSE 'connector_account' END,
    v_connection_id,
    CASE WHEN v_status = 'succeeded' THEN NULL ELSE coalesce(p_error, 'connector sync failed') END,
    jsonb_build_object(
      'jobId', v_job.id,
      'connectionId', v_connection_id,
      'status', v_status
    )
  );

  RETURN jsonb_build_object(
    'jobId', v_job.id,
    'status', v_job.status,
    'connectionId', v_connection_id,
    'jobType', v_job.job_type
  );
END;
$$;
