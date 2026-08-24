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
