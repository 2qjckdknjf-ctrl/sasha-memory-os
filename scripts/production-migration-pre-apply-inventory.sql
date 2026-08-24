-- Pre-apply aggregate inventory (read-only; no memory content)
SELECT 'workspaces' AS k, count(*)::text AS v FROM workspaces;
SELECT id::text, slug, name, status FROM projects ORDER BY slug;
SELECT 'subjects' AS k, count(*)::text AS v FROM subjects;
SELECT external_key, id::text FROM subjects WHERE external_key IN ('chatgpt','cursor','owner') ORDER BY external_key;
SELECT 'acl_total' AS k, count(*)::text AS v FROM acl_entries;
SELECT 'acl_null_project' AS k, count(*)::text AS v FROM acl_entries WHERE project_id IS NULL;
SELECT 'source_events' AS k, count(*)::text AS v FROM source_events;
SELECT 'memory_records' AS k, count(*)::text AS v FROM memory_records;
SELECT project_id::text AS section, count(*)::text AS v FROM memory_records GROUP BY project_id ORDER BY project_id;
SELECT 'm15_backfill_candidates' AS k, count(*)::text AS v FROM source_events
  WHERE external_id IS NULL OR external_version IS NULL;
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'project_routing_corrections'
) AS routing_corrections_table_exists;
