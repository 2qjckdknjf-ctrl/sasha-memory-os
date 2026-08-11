-- Trusted API RPCs: called with anon key + shared API secret (server-side only).

CREATE TABLE IF NOT EXISTS app.runtime_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION app.assert_api_secret(p_secret text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  expected text;
BEGIN
  SELECT value INTO expected FROM app.runtime_config WHERE key = 'api_secret';
  IF expected IS NULL OR p_secret IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'unauthorized api secret' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app.with_subject(p_subject_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
BEGIN
  PERFORM set_config('app.subject_id', p_subject_id::text, true);
  PERFORM set_config(
    'app.workspace_id',
    (SELECT workspace_id::text FROM subjects WHERE id = p_subject_id),
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.api_project_context(
  p_secret text,
  p_subject_id uuid,
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.has_acl(
    (SELECT workspace_id FROM projects WHERE id = p_project_id),
    'memory',
    'read',
    p_project_id,
    'internal'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'projectId', p_project_id,
    'decisions', COALESCE((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.recorded_at DESC)
      FROM memory_records m
      WHERE m.project_id = p_project_id
        AND m.memory_type = 'decision'
        AND m.status IN ('active', 'verified')
        AND app.has_acl(m.workspace_id, 'memory', 'read', m.project_id, m.sensitivity)
    ), '[]'::jsonb),
    'tasks', COALESCE((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.recorded_at DESC)
      FROM memory_records m
      WHERE m.project_id = p_project_id
        AND m.memory_type = 'task'
        AND m.status IN ('active', 'verified')
        AND app.has_acl(m.workspace_id, 'memory', 'read', m.project_id, m.sensitivity)
    ), '[]'::jsonb),
    'facts', COALESCE((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.recorded_at DESC)
      FROM memory_records m
      WHERE m.project_id = p_project_id
        AND m.memory_type = 'fact'
        AND m.status IN ('active', 'verified')
        AND app.has_acl(m.workspace_id, 'memory', 'read', m.project_id, m.sensitivity)
    ), '[]'::jsonb),
    'state', (
      SELECT to_jsonb(s)
      FROM project_state_versions s
      WHERE s.project_id = p_project_id
      ORDER BY s.version DESC
      LIMIT 1
    ),
    'latestHandoff', (
      SELECT to_jsonb(h)
      FROM handoffs h
      WHERE h.project_id = p_project_id
      ORDER BY h.created_at DESC
      LIMIT 1
    )
  ) INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION app.api_create_decision(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_title text,
  p_content text,
  p_idempotency_key text,
  p_importance numeric DEFAULT 0.8,
  p_confidence numeric DEFAULT 0.9,
  p_sensitivity text DEFAULT 'internal',
  p_rationale text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_event_id uuid;
  v_memory_id uuid;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.has_acl(p_workspace_id, 'memory', 'write', p_project_id, p_sensitivity) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO source_events (
    workspace_id, project_id, provider, event_type, idempotency_key,
    observed_at, sensitivity, storage_mode, payload, created_by_subject
  ) VALUES (
    p_workspace_id, p_project_id, 'manual', 'memory.decision.created', p_idempotency_key,
    now(), p_sensitivity, 'indexed', jsonb_build_object('title', p_title), p_subject_id
  )
  ON CONFLICT (workspace_id, provider, idempotency_key) DO NOTHING;

  SELECT id INTO v_event_id
  FROM source_events
  WHERE workspace_id = p_workspace_id
    AND provider = 'manual'
    AND idempotency_key = p_idempotency_key;

  SELECT id INTO v_memory_id
  FROM memory_records
  WHERE source_event_id = v_event_id AND memory_type = 'decision'
  LIMIT 1;

  IF v_memory_id IS NULL THEN
    INSERT INTO memory_records (
      workspace_id, project_id, memory_type, title, content, status,
      importance, confidence, sensitivity, valid_from, observed_at,
      source_event_id, created_by_subject
    ) VALUES (
      p_workspace_id, p_project_id, 'decision', p_title, p_content, 'verified',
      p_importance, p_confidence, p_sensitivity, now(), now(),
      v_event_id, p_subject_id
    )
    RETURNING id INTO v_memory_id;

    INSERT INTO decisions (memory_id, workspace_id, rationale, decision_maker, effective_at)
    VALUES (v_memory_id, p_workspace_id, p_rationale, p_subject_id::text, now());
  END IF;

  RETURN (SELECT to_jsonb(m) FROM memory_records m WHERE m.id = v_memory_id);
END;
$$;

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

  RETURN (SELECT to_jsonb(h) FROM handoffs h WHERE h.id = v_id);
END;
$$;

CREATE OR REPLACE FUNCTION app.api_search_memories(
  p_secret text,
  p_subject_id uuid,
  p_query text,
  p_project_id uuid DEFAULT NULL,
  p_include_history boolean DEFAULT false
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

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'memory', to_jsonb(m),
      'score', m.importance * m.confidence,
      'reason', 'structured+text'
    ) ORDER BY m.importance * m.confidence DESC)
    FROM memory_records m
    WHERE (p_project_id IS NULL OR m.project_id = p_project_id)
      AND (
        p_include_history
        OR m.status IN ('active', 'verified', 'candidate')
      )
      AND (
        p_query IS NULL OR p_query = ''
        OR m.title ILIKE '%' || p_query || '%'
        OR m.content ILIKE '%' || p_query || '%'
      )
      AND app.has_acl(m.workspace_id, 'memory', 'read', m.project_id, m.sensitivity)
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION app.api_rls_probe(
  p_secret text,
  p_subject_id uuid,
  p_project_id uuid,
  p_sensitivity text DEFAULT 'internal'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_workspace uuid;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);
  SELECT workspace_id INTO v_workspace FROM projects WHERE id = p_project_id;

  RETURN jsonb_build_object(
    'subjectId', p_subject_id,
    'isMember', app.is_workspace_member(v_workspace),
    'canReadMemory', app.has_acl(v_workspace, 'memory', 'read', p_project_id, p_sensitivity),
    'canWriteMemory', app.has_acl(v_workspace, 'memory', 'write', p_project_id, p_sensitivity),
    'canWriteHandoff', app.has_acl(v_workspace, 'handoff', 'write', p_project_id),
    'visibleMemories', (
      SELECT count(*) FROM memory_records m
      WHERE m.project_id = p_project_id
        AND app.has_acl(m.workspace_id, 'memory', 'read', m.project_id, m.sensitivity)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION app.assert_api_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.with_subject(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.api_project_context(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.api_create_decision(text, uuid, uuid, uuid, text, text, text, numeric, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.api_create_handoff(text, uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.api_search_memories(text, uuid, text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.api_rls_probe(text, uuid, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.api_project_context(text, uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_create_decision(text, uuid, uuid, uuid, text, text, text, numeric, numeric, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_create_handoff(text, uuid, uuid, uuid, uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_search_memories(text, uuid, text, uuid, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_rls_probe(text, uuid, uuid, text) TO anon, authenticated, service_role;

-- Expose RPCs via PostgREST (public aliases)
CREATE OR REPLACE FUNCTION public.api_project_context(p_secret text, p_subject_id uuid, p_project_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app
AS $$ SELECT app.api_project_context(p_secret, p_subject_id, p_project_id) $$;

CREATE OR REPLACE FUNCTION public.api_create_decision(
  p_secret text, p_subject_id uuid, p_workspace_id uuid, p_project_id uuid,
  p_title text, p_content text, p_idempotency_key text,
  p_importance numeric DEFAULT 0.8, p_confidence numeric DEFAULT 0.9,
  p_sensitivity text DEFAULT 'internal', p_rationale text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app
AS $$ SELECT app.api_create_decision(
  p_secret, p_subject_id, p_workspace_id, p_project_id, p_title, p_content,
  p_idempotency_key, p_importance, p_confidence, p_sensitivity, p_rationale
) $$;

CREATE OR REPLACE FUNCTION public.api_create_handoff(
  p_secret text, p_subject_id uuid, p_workspace_id uuid, p_project_id uuid,
  p_to_subject_id uuid, p_payload jsonb
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app
AS $$ SELECT app.api_create_handoff(
  p_secret, p_subject_id, p_workspace_id, p_project_id, p_to_subject_id, p_payload
) $$;

CREATE OR REPLACE FUNCTION public.api_search_memories(
  p_secret text, p_subject_id uuid, p_query text,
  p_project_id uuid DEFAULT NULL, p_include_history boolean DEFAULT false
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app
AS $$ SELECT app.api_search_memories(
  p_secret, p_subject_id, p_query, p_project_id, p_include_history
) $$;

CREATE OR REPLACE FUNCTION public.api_rls_probe(
  p_secret text, p_subject_id uuid, p_project_id uuid, p_sensitivity text DEFAULT 'internal'
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app
AS $$ SELECT app.api_rls_probe(p_secret, p_subject_id, p_project_id, p_sensitivity) $$;

GRANT EXECUTE ON FUNCTION public.api_project_context(text, uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_create_decision(text, uuid, uuid, uuid, text, text, text, numeric, numeric, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_create_handoff(text, uuid, uuid, uuid, uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_search_memories(text, uuid, text, uuid, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_rls_probe(text, uuid, uuid, text) TO anon, authenticated, service_role;
