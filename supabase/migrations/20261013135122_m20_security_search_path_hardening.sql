-- M20 security boundary: trusted Memory OS runtimes use the server-only
-- service_role key plus the existing API secret. Browser/auth client roles
-- keep Supabase Auth access but cannot invoke privileged Memory RPCs directly.

ALTER FUNCTION app.sanitize_memory_conflict_evidence_refs(jsonb)
  SET search_path = pg_catalog;

ALTER DEFAULT PRIVILEGES IN SCHEMA app
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app TO service_role;

DO $$
DECLARE
  v_function record;
BEGIN
  -- The app schema is private implementation detail. SECURITY DEFINER public
  -- wrappers run as their owner; trusted maintenance may use service_role.
  FOR v_function IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
      v_function.schema_name,
      v_function.function_name,
      v_function.identity_arguments
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
      v_function.schema_name,
      v_function.function_name,
      v_function.identity_arguments
    );
  END LOOP;

  -- Only Memory OS RPC wrappers are changed in public. Extension and Supabase
  -- platform functions keep their provider-managed privileges.
  FOR v_function IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND left(p.proname, 4) = 'api_'
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
      v_function.schema_name,
      v_function.function_name,
      v_function.identity_arguments
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
      v_function.schema_name,
      v_function.function_name,
      v_function.identity_arguments
    );
  END LOOP;
END;
$$;
