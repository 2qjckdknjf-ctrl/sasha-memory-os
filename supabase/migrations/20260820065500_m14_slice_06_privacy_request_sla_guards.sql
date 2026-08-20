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
  v_trimmed_reason text;
  v_trimmed_correction_text text;
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

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required';
  END IF;

  v_trimmed_reason := nullif(btrim(coalesce(p_reason, '')), '');
  IF v_trimmed_reason IS NULL THEN
    RAISE EXCEPTION 'reason required';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency key required';
  END IF;

  v_trimmed_correction_text := nullif(btrim(coalesce(p_correction_text, '')), '');

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

    IF v_memory.project_id IS DISTINCT FROM p_project_id THEN
      RAISE EXCEPTION 'project mismatch';
    END IF;
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
    v_trimmed_reason,
    v_trimmed_correction_text,
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
    'privacy request submitted',
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
      SELECT jsonb_strip_nulls(jsonb_build_object(
        'id', s.id,
        'externalKey', s.external_key,
        'displayName', s.display_name,
        'kind', s.kind
      ))
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
