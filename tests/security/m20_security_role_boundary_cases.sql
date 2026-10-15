\set ON_ERROR_STOP on

-- Privileged Memory RPCs are server-only. The public browser key remains valid
-- for Supabase Auth, but cannot call SECURITY DEFINER memory functions.
DO $$
DECLARE
  v_mutable_search_path integer;
BEGIN
  IF has_function_privilege(
    'anon',
    'public.api_list_projects(text,uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon can still execute privileged Memory RPCs';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.api_list_projects(text,uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated can still execute privileged Memory RPCs';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.api_list_projects(text,uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot execute privileged Memory RPCs';
  END IF;

  IF has_schema_privilege('anon', 'app', 'USAGE')
     OR has_schema_privilege('authenticated', 'app', 'USAGE') THEN
    RAISE EXCEPTION 'private app schema remains visible to a client role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND left(p.proname, 4) = 'api_'
      AND (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ) THEN
    RAISE EXCEPTION 'a public SECURITY DEFINER Memory RPC is client executable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND left(p.proname, 4) = 'api_'
      AND NOT p.prosecdef
  ) THEN
    RAISE EXCEPTION 'a privileged public Memory RPC is not SECURITY DEFINER';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND left(p.proname, 4) = 'api_'
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'service_role cannot execute every privileged Memory RPC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (
      (n.nspname = 'public' AND left(p.proname, 4) = 'api_')
      OR n.nspname = 'app'
    )
      AND p.prosecdef
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS config(value)
        WHERE config.value LIKE 'search_path=%'
      )
  ) THEN
    RAISE EXCEPTION 'a Memory SECURITY DEFINER function has mutable search_path';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app'
      AND (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ) THEN
    RAISE EXCEPTION 'a private app function is client executable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'a public Memory table does not have RLS enabled';
  END IF;

  IF has_table_privilege('anon', 'public.connector_vault_blobs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.connector_vault_blobs', 'SELECT')
     OR has_table_privilege('anon', 'public.project_routing_corrections', 'SELECT')
     OR has_table_privilege('authenticated', 'public.project_routing_corrections', 'SELECT') THEN
    RAISE EXCEPTION 'a deny-by-construction sensitive table is client readable';
  END IF;

  SELECT count(*)::integer
  INTO v_mutable_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app'
    AND p.proname = 'sanitize_memory_conflict_evidence_refs'
    AND NOT coalesce(p.proconfig, '{}') @> ARRAY['search_path=pg_catalog'];

  IF v_mutable_search_path <> 0 THEN
    RAISE EXCEPTION 'sanitizer search_path is still mutable';
  END IF;
END;
$$;

\echo m20_security_role_boundary_cases=pass
