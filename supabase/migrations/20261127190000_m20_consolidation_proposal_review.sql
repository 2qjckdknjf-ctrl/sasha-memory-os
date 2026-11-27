-- M20.3: proposal-only consolidation review gate on existing memory_conflicts.
-- Extends reasons for stale / repeatedly-disproven / near-duplicate merge proposals
-- and adds independent-reviewer decide + supersession rollback RPCs.

DROP FUNCTION IF EXISTS public.api_upsert_memory_conflict(
  text, uuid, uuid, uuid, text, text, text, uuid, uuid, jsonb, text
);
DROP FUNCTION IF EXISTS app.api_upsert_memory_conflict(
  text, uuid, uuid, uuid, text, text, text, uuid, uuid, jsonb, text
);

ALTER TABLE memory_conflicts
  DROP CONSTRAINT IF EXISTS memory_conflicts_reason_check;

ALTER TABLE memory_conflicts
  ADD CONSTRAINT memory_conflicts_reason_check
  CHECK (reason IN (
    'same-title-divergent-content',
    'disputed-current-fact',
    'superseded-current-fact',
    'retracted-current-fact',
    'corrected-current-fact',
    'stale-version',
    'repeatedly-disproven',
    'near-duplicate-merge'
  ));

CREATE OR REPLACE FUNCTION app.api_upsert_memory_conflict(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_conflict_key text,
  p_title text,
  p_reason text,
  p_left_memory_id uuid,
  p_right_memory_id uuid,
  p_evidence_refs jsonb DEFAULT '[]'::jsonb,
  p_detector_version text DEFAULT 'm20-s03-proposal-v1',
  p_detected_by_subject uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_conflict memory_conflicts%ROWTYPE;
  v_conflict_key text := nullif(btrim(coalesce(p_conflict_key, '')), '');
  v_title text := left(coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'untitled'), 240);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_detector_version text := left(coalesce(nullif(btrim(coalesce(p_detector_version, '')), ''), 'm20-s03-proposal-v1'), 64);
  v_evidence_refs jsonb := app.sanitize_memory_conflict_evidence_refs(p_evidence_refs);
  v_detected_by uuid := coalesce(p_detected_by_subject, p_subject_id);
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required';
  END IF;
  IF v_conflict_key IS NULL THEN
    RAISE EXCEPTION 'conflict_key required';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason required';
  END IF;
  IF p_left_memory_id IS NULL OR p_right_memory_id IS NULL THEN
    RAISE EXCEPTION 'memory pair required';
  END IF;
  IF p_left_memory_id = p_right_memory_id THEN
    RAISE EXCEPTION 'memory pair must contain two distinct ids';
  END IF;

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT app.has_acl(p_workspace_id, 'memory', 'read', p_project_id, 'internal') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'owner subject required for contradiction detection';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM memory_records mr
    WHERE mr.id = p_left_memory_id
      AND mr.workspace_id = p_workspace_id
      AND mr.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'left memory not found in project';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM memory_records mr
    WHERE mr.id = p_right_memory_id
      AND mr.workspace_id = p_workspace_id
      AND mr.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'right memory not found in project';
  END IF;

  INSERT INTO memory_conflicts (
    workspace_id,
    project_id,
    conflict_key,
    status,
    title,
    reason,
    left_memory_id,
    right_memory_id,
    evidence_refs,
    detector_version,
    detected_by_subject
  )
  VALUES (
    p_workspace_id,
    p_project_id,
    v_conflict_key,
    'candidate',
    v_title,
    v_reason,
    p_left_memory_id,
    p_right_memory_id,
    v_evidence_refs,
    v_detector_version,
    v_detected_by
  )
  ON CONFLICT (workspace_id, project_id, conflict_key) DO UPDATE
  SET
    status = 'candidate',
    title = EXCLUDED.title,
    reason = EXCLUDED.reason,
    left_memory_id = EXCLUDED.left_memory_id,
    right_memory_id = EXCLUDED.right_memory_id,
    evidence_refs = EXCLUDED.evidence_refs,
    detector_version = EXCLUDED.detector_version,
    detected_by_subject = EXCLUDED.detected_by_subject,
    last_detected_at = now(),
    detection_count = memory_conflicts.detection_count + 1,
    resolved_at = NULL,
    resolved_by_subject = NULL,
    resolution = NULL
  RETURNING * INTO v_conflict;

  RETURN jsonb_build_object(
    'id', v_conflict.id,
    'workspaceId', v_conflict.workspace_id,
    'projectId', v_conflict.project_id,
    'conflictKey', v_conflict.conflict_key,
    'status', v_conflict.status,
    'title', v_conflict.title,
    'reason', v_conflict.reason,
    'memoryIds', jsonb_build_array(v_conflict.left_memory_id, v_conflict.right_memory_id),
    'evidence', v_conflict.evidence_refs,
    'detectorVersion', v_conflict.detector_version,
    'detectionCount', v_conflict.detection_count,
    'detectedBySubject', v_conflict.detected_by_subject
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_upsert_memory_conflict(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_conflict_key text,
  p_title text,
  p_reason text,
  p_left_memory_id uuid,
  p_right_memory_id uuid,
  p_evidence_refs jsonb DEFAULT '[]'::jsonb,
  p_detector_version text DEFAULT 'm20-s03-proposal-v1',
  p_detected_by_subject uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_upsert_memory_conflict(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_project_id,
    p_conflict_key,
    p_title,
    p_reason,
    p_left_memory_id,
    p_right_memory_id,
    p_evidence_refs,
    p_detector_version,
    p_detected_by_subject
  );
$$;

CREATE OR REPLACE FUNCTION app.api_restore_superseded_memory(
  p_secret text,
  p_subject_id uuid,
  p_memory_id uuid,
  p_prior_status text,
  p_reason text DEFAULT 'consolidation proposal rollback'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_row memory_records%ROWTYPE;
  v_status text := nullif(btrim(coalesce(p_prior_status, '')), '');
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'consolidation proposal rollback');
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'prior_status required';
  END IF;

  SELECT * INTO v_row FROM memory_records WHERE id = p_memory_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'memory not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM workspace_memberships wm
    WHERE wm.workspace_id = v_row.workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE memory_records
  SET
    status = v_status,
    superseded_by = NULL,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'status_reason', v_reason,
      'status_actor', p_subject_id,
      'status_at', now(),
      'consolidation_rollback', true
    )
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO audit_log (
    workspace_id, actor_subject_id, action, object_type, object_id, after_state
  ) VALUES (
    v_row.workspace_id,
    p_subject_id,
    'memory.restore_superseded',
    'memory',
    v_row.id,
    jsonb_build_object(
      'memory_id', v_row.id,
      'restored_status', v_status,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'memoryId', v_row.id,
    'status', v_row.status,
    'reason', v_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_restore_superseded_memory(
  p_secret text,
  p_subject_id uuid,
  p_memory_id uuid,
  p_prior_status text,
  p_reason text DEFAULT 'consolidation proposal rollback'
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_restore_superseded_memory(
    p_secret,
    p_subject_id,
    p_memory_id,
    p_prior_status,
    p_reason
  );
$$;

CREATE OR REPLACE FUNCTION app.api_decide_memory_conflict(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_conflict_id uuid,
  p_decision text,
  p_reason text,
  p_keeper_id uuid DEFAULT NULL,
  p_duplicate_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_conflict memory_conflicts%ROWTYPE;
  v_decision text := nullif(btrim(coalesce(p_decision, '')), '');
  v_reason text := left(coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'reviewed'), 500);
  v_keeper uuid;
  v_duplicate uuid;
  v_prior_status text;
  v_supersede jsonb;
  v_restore jsonb;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF v_decision IS NULL OR v_decision NOT IN ('approve', 'dismiss', 'rollback') THEN
    RAISE EXCEPTION 'decision must be approve, dismiss, or rollback';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.subject_id = p_subject_id
      AND wm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conflict
  FROM memory_conflicts
  WHERE id = p_conflict_id
    AND workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'memory conflict not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.has_acl(p_workspace_id, 'memory', 'write', v_conflict.project_id, 'internal') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_decision IN ('approve', 'rollback')
     AND v_conflict.detected_by_subject IS NOT NULL
     AND v_conflict.detected_by_subject = p_subject_id THEN
    RAISE EXCEPTION 'reviewer cannot self-approve consolidation proposals' USING ERRCODE = '42501';
  END IF;

  IF v_decision = 'dismiss' THEN
    IF v_conflict.status <> 'candidate' THEN
      RAISE EXCEPTION 'only candidate conflicts can be dismissed';
    END IF;
    UPDATE memory_conflicts
    SET
      status = 'dismissed',
      resolved_at = now(),
      resolved_by_subject = p_subject_id,
      resolution = jsonb_build_object(
        'decision', 'dismiss',
        'reason', v_reason
      )
    WHERE id = v_conflict.id
    RETURNING * INTO v_conflict;

    INSERT INTO audit_log (
      workspace_id, actor_subject_id, action, object_type, object_id, after_state
    ) VALUES (
      p_workspace_id,
      p_subject_id,
      'memory_conflict.dismissed',
      'memory_conflict',
      v_conflict.id,
      jsonb_build_object('decision', 'dismiss', 'reason', v_reason)
    );
  ELSIF v_decision = 'approve' THEN
    IF v_conflict.status <> 'candidate' THEN
      RAISE EXCEPTION 'only candidate conflicts can be approved';
    END IF;
    v_keeper := coalesce(p_keeper_id, v_conflict.right_memory_id);
    v_duplicate := coalesce(p_duplicate_id, v_conflict.left_memory_id);
    IF v_keeper = v_duplicate THEN
      RAISE EXCEPTION 'keeper and duplicate must differ';
    END IF;
    SELECT status INTO v_prior_status FROM memory_records WHERE id = v_duplicate;
    IF v_prior_status IS NULL THEN
      RAISE EXCEPTION 'duplicate memory not found' USING ERRCODE = 'P0002';
    END IF;
    v_supersede := app.api_supersede_memory(
      p_secret,
      p_subject_id,
      v_duplicate,
      v_keeper,
      v_reason
    );
    UPDATE memory_conflicts
    SET
      status = 'resolved',
      resolved_at = now(),
      resolved_by_subject = p_subject_id,
      resolution = jsonb_build_object(
        'decision', 'approve',
        'reason', v_reason,
        'keeperId', v_keeper,
        'duplicateId', v_duplicate,
        'priorDuplicateStatus', v_prior_status,
        'supersede', v_supersede
      )
    WHERE id = v_conflict.id
    RETURNING * INTO v_conflict;

    INSERT INTO audit_log (
      workspace_id, actor_subject_id, action, object_type, object_id, after_state
    ) VALUES (
      p_workspace_id,
      p_subject_id,
      'memory_conflict.approved',
      'memory_conflict',
      v_conflict.id,
      jsonb_build_object(
        'decision', 'approve',
        'reason', v_reason,
        'keeperId', v_keeper,
        'duplicateId', v_duplicate
      )
    );
  ELSE
    IF v_conflict.status <> 'resolved' THEN
      RAISE EXCEPTION 'only resolved conflicts can be rolled back';
    END IF;
    v_duplicate := nullif(v_conflict.resolution->>'duplicateId', '')::uuid;
    v_prior_status := nullif(v_conflict.resolution->>'priorDuplicateStatus', '');
    IF v_duplicate IS NULL OR v_prior_status IS NULL THEN
      RAISE EXCEPTION 'resolution lacks rollback provenance';
    END IF;
    v_restore := app.api_restore_superseded_memory(
      p_secret,
      p_subject_id,
      v_duplicate,
      v_prior_status,
      v_reason
    );
    UPDATE memory_conflicts
    SET
      status = 'candidate',
      resolved_at = NULL,
      resolved_by_subject = NULL,
      resolution = coalesce(resolution, '{}'::jsonb) || jsonb_build_object(
        'rolledBackAt', now(),
        'rolledBackBy', p_subject_id,
        'rollbackReason', v_reason,
        'restore', v_restore
      )
    WHERE id = v_conflict.id
    RETURNING * INTO v_conflict;

    INSERT INTO audit_log (
      workspace_id, actor_subject_id, action, object_type, object_id, after_state
    ) VALUES (
      p_workspace_id,
      p_subject_id,
      'memory_conflict.rolled_back',
      'memory_conflict',
      v_conflict.id,
      jsonb_build_object(
        'decision', 'rollback',
        'reason', v_reason,
        'duplicateId', v_duplicate,
        'restoredStatus', v_prior_status
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_conflict.id,
    'workspaceId', v_conflict.workspace_id,
    'projectId', v_conflict.project_id,
    'conflictKey', v_conflict.conflict_key,
    'status', v_conflict.status,
    'title', v_conflict.title,
    'reason', v_conflict.reason,
    'memoryIds', jsonb_build_array(v_conflict.left_memory_id, v_conflict.right_memory_id),
    'resolution', v_conflict.resolution,
    'resolvedAt', v_conflict.resolved_at,
    'resolvedBySubject', v_conflict.resolved_by_subject,
    'detectedBySubject', v_conflict.detected_by_subject
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_decide_memory_conflict(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_conflict_id uuid,
  p_decision text,
  p_reason text,
  p_keeper_id uuid DEFAULT NULL,
  p_duplicate_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_decide_memory_conflict(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_conflict_id,
    p_decision,
    p_reason,
    p_keeper_id,
    p_duplicate_id
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_upsert_memory_conflict(
  text, uuid, uuid, uuid, text, text, text, uuid, uuid, jsonb, text, uuid
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_upsert_memory_conflict(
  text, uuid, uuid, uuid, text, text, text, uuid, uuid, jsonb, text, uuid
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_restore_superseded_memory(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_restore_superseded_memory(text, uuid, uuid, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_decide_memory_conflict(
  text, uuid, uuid, uuid, text, text, uuid, uuid
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_decide_memory_conflict(
  text, uuid, uuid, uuid, text, text, uuid, uuid
) TO anon, authenticated, service_role;
