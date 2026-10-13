-- Post-apply aggregate verification (no memory content)
SELECT id::text, slug, name, status FROM projects WHERE id IN (
  '44444444-4444-4444-8444-444444444401',
  '44444444-4444-4444-8444-444444444402',
  '44444444-4444-4444-8444-444444444403'
) ORDER BY slug;

SELECT 'acl_cursor_aistroyka' AS k, count(*)::text AS v
FROM acl_entries a JOIN subjects s ON s.id = a.subject_id
WHERE s.external_key = 'cursor' AND a.project_id = '44444444-4444-4444-8444-444444444401' AND a.effect = 'allow';

SELECT 'acl_null_project_agents' AS k, count(*)::text AS v
FROM acl_entries a JOIN subjects s ON s.id = a.subject_id
WHERE s.external_key IN ('chatgpt','cursor') AND a.project_id IS NULL AND a.effect = 'allow';

SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND relname = 'project_routing_corrections';

SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'app' AND proname = 'effective_memory_project_id';

DO $$
BEGIN
  IF to_regprocedure(
    'public.api_reconcile_terminal_outbox(text,uuid,uuid,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'M15 runtime reconciliation function is missing';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.api_list_projects(text,uuid,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.api_list_projects(text,uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'M20 client-role RPC revocation is missing';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.api_list_projects(text,uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'M20 service-role RPC grant is missing';
  END IF;

  IF has_schema_privilege('anon', 'app', 'USAGE')
     OR has_schema_privilege('authenticated', 'app', 'USAGE') THEN
    RAISE EXCEPTION 'M20 private app schema boundary is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app'
      AND p.proname = 'sanitize_memory_conflict_evidence_refs'
      AND NOT coalesce(p.proconfig, '{}') @> ARRAY['search_path=pg_catalog']
  ) THEN
    RAISE EXCEPTION 'M20 sanitizer search_path hardening is missing';
  END IF;
END;
$$;

SELECT 'm15_runtime_m20_security_verification' AS check_name, 'pass' AS result;
