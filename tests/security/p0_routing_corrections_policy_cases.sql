-- P0 routing corrections RLS + privileged RPC cases (ephemeral Supabase after full migration chain).
\set ON_ERROR_STOP on

SELECT relrowsecurity AS rls_enabled_on_project_routing_corrections
FROM pg_class
WHERE oid = 'public.project_routing_corrections'::regclass;
\echo expect: rls_enabled_on_project_routing_corrections = t

-- Direct REST/Data API access must be denied for client roles.
\set anon_denied 0
DO $$
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM count(*) FROM project_routing_corrections;
    RAISE EXCEPTION 'permission denied for anon';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END $$;

DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM count(*) FROM project_routing_corrections;
    RAISE EXCEPTION 'permission denied for authenticated';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END $$;

RESET ROLE;

-- Non-owner agents cannot apply corrections even with API secret.
SELECT set_config('app.api_secret', (
  SELECT value FROM app.runtime_config WHERE key = 'api_secret'
), true);

DO $$
DECLARE
  v_memory_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
  v_aistroyka uuid := '44444444-4444-4444-8444-444444444401';
  v_memory_os uuid := '44444444-4444-4444-8444-444444444402';
  v_workspace uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '33333333-3333-4333-8333-333333333301';
  v_chatgpt uuid := '33333333-3333-4333-8333-333333333302';
  v_cursor uuid := '33333333-3333-4333-8333-333333333303';
  v_secret text := current_setting('app.api_secret', true);
BEGIN
  INSERT INTO memory_records (
    id, workspace_id, project_id, memory_type, title, content, status,
    sensitivity, importance, confidence, schema_version, recorded_at, observed_at
  ) VALUES (
    v_memory_id, v_workspace, v_aistroyka, 'decision', 'RLS routing test memory',
    'Stored under AISTROYKA for correction RPC tests', 'active', 'internal',
    0.8, 0.9, 1, now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  BEGIN
    PERFORM app.api_apply_project_routing_correction(
      v_secret, v_chatgpt, v_memory_id, v_memory_os,
      'MOVE_TO_MEMORY_OS', 'chatgpt must not apply', '{}'::jsonb
    );
    RAISE EXCEPTION 'chatgpt cannot apply routing correction';
  EXCEPTION
    WHEN insufficient_privilege OR SQLSTATE '42501' THEN
      NULL;
  END;

  BEGIN
    PERFORM app.api_apply_project_routing_correction(
      v_secret, v_cursor, v_memory_id, v_memory_os,
      'MOVE_TO_MEMORY_OS', 'cursor must not apply', '{}'::jsonb
    );
    RAISE EXCEPTION 'cursor cannot apply routing correction';
  EXCEPTION
    WHEN insufficient_privilege OR SQLSTATE '42501' THEN
      NULL;
  END;

  PERFORM app.api_apply_project_routing_correction(
    v_secret, v_owner, v_memory_id, v_memory_os,
    'MOVE_TO_MEMORY_OS', 'owner routing correction apply succeeds', '{}'::jsonb
  );

  IF app.effective_memory_project_id(v_memory_id) <> v_memory_os THEN
    RAISE EXCEPTION 'effective project not updated after owner correction';
  END IF;

  PERFORM app.api_apply_project_routing_correction(
    v_secret, v_owner, v_memory_id, v_memory_os,
    'MOVE_TO_MEMORY_OS', 'owner routing correction apply succeeds idempotent', '{}'::jsonb
  );
END $$;

\echo p0_routing_corrections_policy_cases=pass
