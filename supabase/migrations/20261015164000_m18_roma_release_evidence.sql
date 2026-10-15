-- M18.3: preserve bounded release evidence through ROMA approval checkpoints.

CREATE OR REPLACE FUNCTION app.sanitize_roma_qa_finding_evidence_refs(p_refs jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, app
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'kind', NULLIF(btrim(ref.value->>'kind'), ''),
        'memoryId', NULLIF(btrim(ref.value->>'memoryId'), ''),
        'memoryType', NULLIF(btrim(COALESCE(ref.value->>'memoryType', ref.value->>'memory_type')), ''),
        'handoffId', NULLIF(btrim(ref.value->>'handoffId'), ''),
        'stateVersion', CASE
          WHEN jsonb_typeof(ref.value->'stateVersion') = 'number' THEN ref.value->'stateVersion'
          ELSE NULL
        END,
        'field', NULLIF(left(btrim(ref.value->>'field'), 120), ''),
        'title', NULLIF(left(btrim(ref.value->>'title'), 160), ''),
        'titles', CASE
          WHEN jsonb_typeof(ref.value->'titles') = 'array' THEN (
            SELECT COALESCE(
              jsonb_agg(to_jsonb(left(btrim(item.value #>> '{}'), 160)) ORDER BY item.ordinality),
              '[]'::jsonb
            )
            FROM jsonb_array_elements(ref.value->'titles') WITH ORDINALITY AS item(value, ordinality)
            WHERE jsonb_typeof(item.value) = 'string'
              AND btrim(item.value #>> '{}') <> ''
              AND item.ordinality <= 12
          )
          ELSE NULL
        END,
        'createdAt', NULLIF(left(btrim(ref.value->>'createdAt'), 64), ''),
        'releaseType', CASE
          WHEN ref.value->>'releaseType' IN ('pull_request', 'commit', 'deployment')
            THEN ref.value->>'releaseType'
          ELSE NULL
        END,
        'value', NULLIF(left(btrim(ref.value->>'value'), 512), ''),
        'url', CASE
          WHEN btrim(COALESCE(ref.value->>'url', '')) ~* '^(https?://|memory-os://)'
            THEN left(btrim(ref.value->>'url'), 2048)
          ELSE NULL
        END,
        'citationIds', CASE
          WHEN jsonb_typeof(ref.value->'citationIds') = 'array' THEN (
            SELECT COALESCE(
              jsonb_agg(to_jsonb(left(btrim(item.value #>> '{}'), 256)) ORDER BY item.ordinality),
              '[]'::jsonb
            )
            FROM jsonb_array_elements(ref.value->'citationIds') WITH ORDINALITY AS item(value, ordinality)
            WHERE jsonb_typeof(item.value) = 'string'
              AND btrim(item.value #>> '{}') <> ''
              AND item.ordinality <= 12
          )
          ELSE NULL
        END
      )) ORDER BY ref.ordinality
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(COALESCE(p_refs, '[]'::jsonb)) = 'array' THEN COALESCE(p_refs, '[]'::jsonb)
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS ref(value, ordinality)
  WHERE ref.ordinality <= 12;
$$;
CREATE OR REPLACE FUNCTION app.format_roma_qa_finding_evidence_ref(p_ref jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, app
AS $$
DECLARE
  v_kind text := COALESCE(NULLIF(btrim(p_ref->>'kind'), ''), 'unknown');
  v_memory_id text := NULLIF(btrim(p_ref->>'memoryId'), '');
  v_memory_type text := NULLIF(btrim(COALESCE(p_ref->>'memoryType', p_ref->>'memory_type')), '');
  v_handoff_id text := NULLIF(btrim(p_ref->>'handoffId'), '');
  v_field text := NULLIF(btrim(p_ref->>'field'), '');
  v_title text := NULLIF(btrim(p_ref->>'title'), '');
  v_created_at text := NULLIF(btrim(p_ref->>'createdAt'), '');
  v_release_type text := NULLIF(btrim(p_ref->>'releaseType'), '');
  v_value text := NULLIF(btrim(p_ref->>'value'), '');
  v_url text := NULLIF(btrim(p_ref->>'url'), '');
  v_state_version text := CASE
    WHEN jsonb_typeof(p_ref->'stateVersion') = 'number' THEN p_ref->>'stateVersion'
    ELSE NULL
  END;
  v_titles text[];
BEGIN
  v_titles := ARRAY(
    SELECT left(btrim(value #>> '{}'), 160)
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(COALESCE(p_ref->'titles', '[]'::jsonb)) = 'array' THEN COALESCE(p_ref->'titles', '[]'::jsonb)
        ELSE '[]'::jsonb
      END
    ) AS value
    WHERE jsonb_typeof(value) = 'string'
      AND btrim(value #>> '{}') <> ''
  );

  CASE v_kind
    WHEN 'memory' THEN
      RETURN format(
        '- memory %s%s%s',
        COALESCE(v_memory_id, 'none'),
        CASE WHEN v_memory_type IS NULL THEN '' ELSE format(' (%s)', v_memory_type) END,
        CASE WHEN v_title IS NULL THEN '' ELSE format(': %s', v_title) END
      );
    WHEN 'project_state' THEN
      RETURN format(
        '- project_state v%s field %s%s',
        COALESCE(v_state_version, 'unknown'),
        COALESCE(v_field, 'unknown'),
        CASE
          WHEN COALESCE(array_length(v_titles, 1), 0) = 0 THEN ''
          ELSE format(': %s', array_to_string(v_titles, '; '))
        END
      );
    WHEN 'handoff' THEN
      RETURN format(
        '- handoff %s%s',
        COALESCE(v_handoff_id, 'none'),
        CASE WHEN v_created_at IS NULL THEN '' ELSE format(' at %s', v_created_at) END
      );
    WHEN 'release' THEN
      RETURN format(
        '- release %s %s%s%s',
        COALESCE(v_release_type, 'evidence'),
        COALESCE(v_value, 'unknown'),
        CASE WHEN v_url IS NULL THEN '' ELSE format(' (%s)', v_url) END,
        CASE WHEN v_title IS NULL THEN '' ELSE format(': %s', v_title) END
      );
    ELSE
      RETURN format(
        '- %s%s',
        v_kind,
        CASE WHEN v_title IS NULL THEN '' ELSE format(': %s', v_title) END
      );
  END CASE;
END;
$$;
