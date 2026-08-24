-- AISTROYKA project bootstrap for migrations that FK acl_entries.project_id.

INSERT INTO projects (id, workspace_id, slug, name, status, aliases)
VALUES (
  '44444444-4444-4444-8444-444444444401',
  '11111111-1111-4111-8111-111111111111',
  'aistroyka',
  'AISTROYKA',
  'active',
  ARRAY['aistroyka', 'ais']
)
ON CONFLICT (id) DO NOTHING;
