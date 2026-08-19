-- Owner correction flow: supersede a memory with an authoritative replacement and reason.

CREATE OR REPLACE FUNCTION app.api_correct_memory(
  p_secret text,
  p_subject_id uuid,
  p_memory_id uuid,
  p_reason text,
  p_title text DEFAULT NULL,
  p_content text DEFAULT NULL,
  p_replacement_memory_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_original memory_records%ROWTYPE;
  v_authoritative memory_records%ROWTYPE;
  v_decision decisions%ROWTYPE;
  v_task tasks%ROWTYPE;
  v_before_state jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  v_title text := nullif(btrim(p_title), '');
  v_content text := nullif(btrim(p_content), '');
  v_revision integer;
  v_corrected_at timestamptz := now();
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason required';
  END IF;

  SELECT * INTO v_original
  FROM memory_records
  WHERE id = p_memory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'memory not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_original.status = 'superseded' THEN
    RAISE EXCEPTION 'superseded memory cannot be corrected';
  END IF;

  IF v_original.status = 'deleted' THEN
    RAISE EXCEPTION 'deleted memory cannot be corrected';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM workspace_memberships wm
    WHERE wm.workspace_id = v_original.workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_replacement_memory_id IS NULL AND v_content IS NULL THEN
    RAISE EXCEPTION 'content is required when replacement memory is not provided';
  END IF;

  IF p_replacement_memory_id IS NOT NULL AND (v_title IS NOT NULL OR v_content IS NOT NULL) THEN
    RAISE EXCEPTION 'replacement_memory_id cannot be combined with title or content';
  END IF;

  SELECT coalesce(max(mr.revision), 0) + 1
  INTO v_revision
  FROM memory_revisions mr
  WHERE mr.memory_id = v_original.id;

  INSERT INTO memory_revisions (
    workspace_id,
    memory_id,
    revision,
    snapshot,
    reason,
    created_by_subject,
    created_at
  )
  VALUES (
    v_original.workspace_id,
    v_original.id,
    v_revision,
    to_jsonb(v_original),
    v_reason,
    p_subject_id,
    v_corrected_at
  );

  v_before_state := jsonb_build_object(
    'memoryId', v_original.id,
    'status', v_original.status,
    'title', v_original.title,
    'content', v_original.content,
    'projectId', v_original.project_id
  );

  IF p_replacement_memory_id IS NOT NULL THEN
    IF p_replacement_memory_id = v_original.id THEN
      RAISE EXCEPTION 'replacement memory must differ';
    END IF;

    SELECT * INTO v_authoritative
    FROM memory_records
    WHERE id = p_replacement_memory_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'replacement memory not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_authoritative.workspace_id <> v_original.workspace_id THEN
      RAISE EXCEPTION 'workspace mismatch';
    END IF;

    IF v_authoritative.project_id IS DISTINCT FROM v_original.project_id THEN
      RAISE EXCEPTION 'project mismatch';
    END IF;

    IF v_authoritative.status = 'superseded' THEN
      RAISE EXCEPTION 'superseded replacement memory cannot become authoritative';
    END IF;

    UPDATE memory_records
    SET
      status = 'verified',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'status_reason', v_reason,
        'status_actor', p_subject_id,
        'status_at', v_corrected_at,
        'corrected_from', v_original.id,
        'correction_reason', v_reason,
        'correction_actor', p_subject_id,
        'correction_at', v_corrected_at
      )
    WHERE id = v_authoritative.id
    RETURNING * INTO v_authoritative;
  ELSE
    INSERT INTO memory_records (
      workspace_id,
      project_id,
      memory_type,
      title,
      content,
      status,
      importance,
      confidence,
      sensitivity,
      valid_from,
      valid_to,
      observed_at,
      recorded_at,
      superseded_by,
      source_event_id,
      created_by_subject,
      schema_version,
      metadata
    )
    VALUES (
      v_original.workspace_id,
      v_original.project_id,
      v_original.memory_type,
      coalesce(v_title, v_original.title),
      v_content,
      'verified',
      v_original.importance,
      v_original.confidence,
      v_original.sensitivity,
      v_original.valid_from,
      v_original.valid_to,
      v_original.observed_at,
      v_corrected_at,
      NULL,
      v_original.source_event_id,
      p_subject_id,
      v_original.schema_version,
      coalesce(v_original.metadata, '{}'::jsonb) || jsonb_build_object(
        'status_reason', v_reason,
        'status_actor', p_subject_id,
        'status_at', v_corrected_at,
        'corrected_from', v_original.id,
        'correction_reason', v_reason,
        'correction_actor', p_subject_id,
        'correction_at', v_corrected_at
      )
    )
    RETURNING * INTO v_authoritative;

    SELECT * INTO v_decision
    FROM decisions
    WHERE memory_id = v_original.id;

    IF FOUND THEN
      INSERT INTO decisions (
        memory_id,
        workspace_id,
        rationale,
        alternatives,
        decision_maker,
        effective_at
      )
      VALUES (
        v_authoritative.id,
        v_decision.workspace_id,
        v_decision.rationale,
        v_decision.alternatives,
        v_decision.decision_maker,
        v_decision.effective_at
      );
    END IF;

    SELECT * INTO v_task
    FROM tasks
    WHERE memory_id = v_original.id;

    IF FOUND THEN
      INSERT INTO tasks (
        memory_id,
        workspace_id,
        owner_subject_id,
        task_status,
        priority,
        due_at,
        dependencies
      )
      VALUES (
        v_authoritative.id,
        v_task.workspace_id,
        v_task.owner_subject_id,
        v_task.task_status,
        v_task.priority,
        v_task.due_at,
        v_task.dependencies
      );
    END IF;

    INSERT INTO memory_evidence (
      memory_id,
      source_event_id,
      workspace_id,
      evidence_span
    )
    SELECT
      v_authoritative.id,
      me.source_event_id,
      me.workspace_id,
      me.evidence_span
    FROM memory_evidence me
    WHERE me.memory_id = v_original.id
    ON CONFLICT (memory_id, source_event_id) DO NOTHING;
  END IF;

  UPDATE memory_records
  SET
    status = 'superseded',
    superseded_by = v_authoritative.id,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'status_reason', v_reason,
      'status_actor', p_subject_id,
      'status_at', v_corrected_at,
      'corrected_by', v_authoritative.id,
      'correction_reason', v_reason,
      'correction_actor', p_subject_id,
      'correction_at', v_corrected_at
    )
  WHERE id = v_original.id
  RETURNING * INTO v_original;

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
    v_original.workspace_id,
    p_subject_id,
    'memory.correct',
    'memory',
    v_original.id,
    v_reason,
    v_before_state,
    jsonb_build_object(
      'supersededId', v_original.id,
      'authoritativeId', v_authoritative.id,
      'supersededStatus', v_original.status,
      'authoritativeStatus', v_authoritative.status,
      'projectId', v_original.project_id,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'supersededId', v_original.id,
    'authoritativeId', v_authoritative.id,
    'supersededStatus', v_original.status,
    'authoritativeStatus', v_authoritative.status,
    'reason', v_reason,
    'projectId', v_authoritative.project_id,
    'title', v_authoritative.title
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_correct_memory(
  p_secret text,
  p_subject_id uuid,
  p_memory_id uuid,
  p_reason text,
  p_title text DEFAULT NULL,
  p_content text DEFAULT NULL,
  p_replacement_memory_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_correct_memory(
    p_secret,
    p_subject_id,
    p_memory_id,
    p_reason,
    p_title,
    p_content,
    p_replacement_memory_id
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_correct_memory(text, uuid, uuid, text, text, text, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_correct_memory(text, uuid, uuid, text, text, text, uuid)
  TO anon, authenticated, service_role;
