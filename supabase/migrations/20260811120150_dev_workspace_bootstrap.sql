-- Dev workspace bootstrap for fresh migration apply (CI/ephemeral DB).
-- Seed.sql still loads demo memories; this unblocks migrations that reference fixed UUIDs.

INSERT INTO workspaces (id, slug, name, region, settings)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'sasha-home',
  'Sasha Home Workspace',
  'eu',
  '{"pilot": true}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, auth_user_id, email, display_name)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222201',
  'sasha@example.com',
  'Sasha'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO subjects (id, workspace_id, kind, user_id, external_key, display_name, metadata)
VALUES
  (
    '33333333-3333-4333-8333-333333333301',
    '11111111-1111-4111-8111-111111111111',
    'user',
    '22222222-2222-4222-8222-222222222222',
    'owner',
    'Sasha',
    '{}'::jsonb
  ),
  (
    '33333333-3333-4333-8333-333333333302',
    '11111111-1111-4111-8111-111111111111',
    'agent',
    NULL,
    'chatgpt',
    'ChatGPT',
    '{}'::jsonb
  ),
  (
    '33333333-3333-4333-8333-333333333303',
    '11111111-1111-4111-8111-111111111111',
    'agent',
    NULL,
    'cursor',
    'Cursor',
    '{}'::jsonb
  ),
  (
    '33333333-3333-4333-8333-333333333304',
    '11111111-1111-4111-8111-111111111111',
    'agent',
    NULL,
    'roma',
    'ROMA',
    '{"purpose":"audit/qa"}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspace_memberships (workspace_id, user_id, subject_id, role)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333301',
  'owner'
)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO agents (workspace_id, subject_id, client_key, version, capabilities, trust_level)
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333302',
    'chatgpt',
    '1',
    '["memory.read","memory.write.decision"]'::jsonb,
    'standard'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333303',
    'cursor',
    '1',
    '["memory.read.project","session.write","handoff.write"]'::jsonb,
    'standard'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333304',
    'roma',
    '1',
    '["memory.read.project","qa.read"]'::jsonb,
    'standard'
  )
ON CONFLICT (subject_id) DO NOTHING;
