-- M13 Slice 04: durable project-scoped contradiction candidates on the existing consolidation path.

CREATE TABLE memory_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  conflict_key text NOT NULL,
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'resolved', 'dismissed')),
  title text NOT NULL,
  reason text NOT NULL
    CHECK (reason IN (
      'same-title-divergent-content',
      'disputed-current-fact',
      'superseded-current-fact',
      'retracted-current-fact',
      'corrected-current-fact'
    )),
  left_memory_id uuid NOT NULL REFERENCES memory_records (id) ON DELETE CASCADE,
  right_memory_id uuid NOT NULL REFERENCES memory_records (id) ON DELETE CASCADE,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(evidence_refs) = 'array'),
  detector_version text NOT NULL DEFAULT 'm13-s04-v1',
  detected_by_subject uuid REFERENCES subjects (id) ON DELETE SET NULL,
  detection_count integer NOT NULL DEFAULT 1 CHECK (detection_count >= 1),
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_subject uuid REFERENCES subjects (id) ON DELETE SET NULL,
  resolution jsonb,
  UNIQUE (workspace_id, project_id, conflict_key),
  CONSTRAINT memory_conflicts_distinct_pair CHECK (left_memory_id <> right_memory_id)
);

ALTER TABLE memory_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_conflicts FORCE ROW LEVEL SECURITY;

CREATE POLICY memory_conflicts_select
  ON memory_conflicts
  FOR SELECT
  USING (
    app.is_workspace_member(workspace_id)
    AND app.has_acl(workspace_id, 'project', 'read', project_id, 'internal')
  );

CREATE POLICY memory_conflicts_no_insert
  ON memory_conflicts
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY memory_conflicts_no_update
  ON memory_conflicts
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

CREATE POLICY memory_conflicts_no_delete
  ON memory_conflicts
  FOR DELETE
  USING (false);

CREATE INDEX idx_memory_conflicts_project_detected
  ON memory_conflicts (project_id, last_detected_at DESC);
CREATE INDEX idx_memory_conflicts_pair
  ON memory_conflicts (left_memory_id, right_memory_id);

CREATE OR REPLACE FUNCTION app.sanitize_memory_conflict_evidence_refs(
  p_evidence_refs jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  WITH refs AS (
    SELECT value AS item, ordinality
    FROM jsonb_array_elements(COALESCE(p_evidence_refs, '[]'::jsonb)) WITH ORDINALITY
    LIMIT 2
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'memoryId', nullif(btrim(item->>'memoryId'), ''),
        'title', left(coalesce(nullif(btrim(item->>'title'), ''), 'untitled'), 240)
      ))
      ORDER BY ordinality
    ) FILTER (WHERE nullif(btrim(item->>'memoryId'), '') IS NOT NULL),
    '[]'::jsonb
  )
  FROM refs;
$$;

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
  p_detector_version text DEFAULT 'm13-s04-v1'
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
  v_detector_version text := left(coalesce(nullif(btrim(coalesce(p_detector_version, '')), ''), 'm13-s04-v1'), 64);
  v_evidence_refs jsonb := app.sanitize_memory_conflict_evidence_refs(p_evidence_refs);
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
    p_subject_id
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
    detection_count = memory_conflicts.detection_count + 1
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
    'detectionCount', v_conflict.detection_count
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
  p_detector_version text DEFAULT 'm13-s04-v1'
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
    p_detector_version
  );
$$;

GRANT EXECUTE ON FUNCTION app.sanitize_memory_conflict_evidence_refs(jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_upsert_memory_conflict(
  text, uuid, uuid, uuid, text, text, text, uuid, uuid, jsonb, text
)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_upsert_memory_conflict(
  text, uuid, uuid, uuid, text, text, text, uuid, uuid, jsonb, text
)
  TO anon, authenticated, service_role;
