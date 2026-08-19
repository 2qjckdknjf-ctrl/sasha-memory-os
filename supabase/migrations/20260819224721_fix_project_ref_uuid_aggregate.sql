-- Fix api_resolve_project_ref single-match projection for Postgres uuid aggregates.

CREATE OR REPLACE FUNCTION app.api_resolve_project_ref(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_ref text := lower(nullif(btrim(coalesce(p_project_ref, '')), ''));
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_ref IS NULL THEN
    RETURN jsonb_build_object(
      'projectId', NULL,
      'matchCount', 0,
      'candidates', '[]'::jsonb
    );
  END IF;

  RETURN COALESCE((
    WITH project_candidates AS (
      SELECT DISTINCT
        p.id,
        p.slug,
        p.name,
        repo.url
      FROM projects p
      LEFT JOIN LATERAL (
        SELECT
          nullif(value->>'url', '') AS url,
          lower(coalesce(nullif(value->>'collection_id', ''), '')) AS collection_id,
          lower(coalesce(nullif(value->>'external_id', ''), '')) AS external_id,
          lower(coalesce(nullif(value->'metadata'->>'full_name', ''), '')) AS full_name
        FROM jsonb_array_elements(coalesce(p.repositories, '[]'::jsonb)) repo_values(value)
      ) repo ON true
      WHERE p.workspace_id = p_workspace_id
        AND (
          app.has_acl(p.workspace_id, 'memory', 'read', p.id, 'internal')
          OR app.has_acl(p.workspace_id, 'memory', 'write', p.id, 'internal')
          OR app.has_acl(p.workspace_id, 'handoff', 'write', p.id)
        )
        AND (
          lower(p.id::text) = v_ref
          OR lower(p.slug) = v_ref
          OR lower(p.name) = v_ref
          OR lower(coalesce(repo.url, '')) = v_ref
          OR repo.collection_id = v_ref
          OR repo.external_id = v_ref
          OR repo.full_name = v_ref
        )
    )
    SELECT jsonb_build_object(
      'projectId',
      CASE WHEN count(*) = 1 THEN (array_agg(id ORDER BY name, slug))[1]::text ELSE NULL END,
      'matchCount', count(*),
      'candidates', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', id,
            'slug', slug,
            'name', name,
            'url', url
          )
          ORDER BY name, slug
        ),
        '[]'::jsonb
      )
    )
    FROM project_candidates
  ), jsonb_build_object(
    'projectId', NULL,
    'matchCount', 0,
    'candidates', '[]'::jsonb
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.api_resolve_project_ref(
  p_secret text,
  p_subject_id uuid,
  p_workspace_id uuid,
  p_project_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_resolve_project_ref(
    p_secret,
    p_subject_id,
    p_workspace_id,
    p_project_ref
  );
$$;

GRANT EXECUTE ON FUNCTION app.api_resolve_project_ref(text, uuid, uuid, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_resolve_project_ref(text, uuid, uuid, text)
  TO anon, authenticated, service_role;
