-- M18.3 production acceptance: allow ROMA to inspect and write bounded
-- candidate findings for the canonical Sasha Memory OS project.

WITH required_grants(resource_type, actions) AS (
  VALUES
    ('memory'::text, ARRAY['read', 'write']::text[]),
    ('project'::text, ARRAY['read']::text[]),
    ('project_state'::text, ARRAY['read']::text[]),
    ('handoff'::text, ARRAY['read']::text[])
)
INSERT INTO acl_entries (
  workspace_id,
  subject_id,
  effect,
  resource_type,
  project_id,
  actions,
  sensitivity_max
)
SELECT
  '11111111-1111-4111-8111-111111111111'::uuid,
  '33333333-3333-4333-8333-333333333304'::uuid,
  'allow',
  required_grants.resource_type,
  '44444444-4444-4444-8444-444444444402'::uuid,
  required_grants.actions,
  'internal'
FROM required_grants
WHERE NOT EXISTS (
  SELECT 1
  FROM acl_entries existing
  WHERE existing.workspace_id = '11111111-1111-4111-8111-111111111111'::uuid
    AND existing.subject_id = '33333333-3333-4333-8333-333333333304'::uuid
    AND existing.effect = 'allow'
    AND existing.resource_type = required_grants.resource_type
    AND existing.project_id = '44444444-4444-4444-8444-444444444402'::uuid
    AND (
      existing.actions = '{}'::text[]
      OR required_grants.actions <@ existing.actions
    )
    AND (
      existing.sensitivity_max IS NULL
      OR app.sensitivity_rank('internal') <= app.sensitivity_rank(existing.sensitivity_max)
    )
);
