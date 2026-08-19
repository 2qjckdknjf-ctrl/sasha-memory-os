-- Synthetic workspace for local/dev (WP-02)
-- Fixed UUIDs for deterministic tests

INSERT INTO workspaces (id, slug, name, region, settings)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'sasha-home',
  'Sasha Home Workspace',
  'eu',
  '{"pilot": true}'::jsonb
);

INSERT INTO users (id, auth_user_id, email, display_name)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222201',
  'sasha@example.com',
  'Sasha'
);

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
    '{
      "purpose": "Аудит, QA и findings по явно разрешенным проектам без наследования owner-прав.",
      "allowed_tools": [
        "memory.search",
        "memory.get",
        "context.project",
        "capture.text",
        "handoff.create",
        "memory.set_status"
      ]
    }'::jsonb
  );

INSERT INTO workspace_memberships (workspace_id, user_id, subject_id, role)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333301',
  'owner'
);

INSERT INTO agents (workspace_id, subject_id, client_key, version, capabilities, trust_level)
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333302',
    'chatgpt',
    '1',
    '["memory.read","memory.write.decision","memory.write.summary"]'::jsonb,
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
    '["memory.read.project","memory.write.findings","qa.read","handoff.write"]'::jsonb,
    'standard'
  );

INSERT INTO projects (id, workspace_id, slug, name, status, aliases)
VALUES (
  '44444444-4444-4444-8444-444444444401',
  '11111111-1111-4111-8111-111111111111',
  'aistroyka',
  'AISTROYKA',
  'active',
  ARRAY['aistroyka', 'ais']
);

-- ChatGPT: project memory read/write
INSERT INTO acl_entries (workspace_id, subject_id, effect, resource_type, project_id, actions, sensitivity_max)
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333302',
    'allow',
    'memory',
    '44444444-4444-4444-8444-444444444401',
    ARRAY['read', 'write'],
    'internal'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333302',
    'allow',
    'project',
    '44444444-4444-4444-8444-444444444401',
    ARRAY['read'],
    'internal'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333302',
    'allow',
    'project_state',
    '44444444-4444-4444-8444-444444444401',
    ARRAY['read'],
    'internal'
  ),
  -- Cursor: engineering project only; personal denied
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333303',
    'allow',
    'memory',
    '44444444-4444-4444-8444-444444444401',
    ARRAY['read'],
    'internal'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333303',
    'allow',
    'project',
    '44444444-4444-4444-8444-444444444401',
    ARRAY['read'],
    'internal'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333303',
    'allow',
    'project_state',
    '44444444-4444-4444-8444-444444444401',
    ARRAY['read', 'write'],
    'internal'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333303',
    'allow',
    'handoff',
    '44444444-4444-4444-8444-444444444401',
    ARRAY['read', 'write'],
    'internal'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333303',
    'allow',
    'session',
    '44444444-4444-4444-8444-444444444401',
    ARRAY['read', 'write'],
    'internal'
  ),
  -- ROMA: audit/QA on allowlisted project only; no personal/mail/restricted by default
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333304',
    'allow',
    'memory',
    '44444444-4444-4444-8444-444444444401',
    ARRAY['read', 'write'],
    'internal'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333304',
    'allow',
    'project',
    '44444444-4444-4444-8444-444444444401',
    ARRAY['read'],
    'internal'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333304',
    'allow',
    'project_state',
    '44444444-4444-4444-8444-444444444401',
    ARRAY['read'],
    'internal'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333304',
    'allow',
    'handoff',
    '44444444-4444-4444-8444-444444444401',
    ARRAY['read', 'write'],
    'internal'
  );

-- Cursor personal/confidential memory is denied by omission + sensitivity_max=internal
-- on project allows (no ACL grant for personal data).

-- Sample decision for demo slice
INSERT INTO source_events (
  id, workspace_id, project_id, provider, event_type, idempotency_key,
  observed_at, sensitivity, storage_mode, payload, created_by_subject
) VALUES (
  '55555555-5555-4555-8555-555555555501',
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444401',
  'manual',
  'memory.decision.created',
  'manual/chatgpt/decision-slice-01',
  '2026-08-09T10:30:00Z',
  'internal',
  'indexed',
  '{"title":"Slice 01 kickoff order"}'::jsonb,
  '33333333-3333-4333-8333-333333333302'
);

INSERT INTO memory_records (
  id, workspace_id, project_id, memory_type, title, content, status,
  importance, confidence, sensitivity, valid_from, observed_at,
  source_event_id, created_by_subject
) VALUES (
  '66666666-6666-4666-8666-666666666601',
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444401',
  'decision',
  'Порядок начала Slice 01',
  'Slice 01 начинается после Product Design Audit PR #215.',
  'verified',
  0.860,
  0.990,
  'internal',
  '2026-08-09T00:00:00Z',
  '2026-08-09T10:30:00Z',
  '55555555-5555-4555-8555-555555555501',
  '33333333-3333-4333-8333-333333333302'
);

INSERT INTO decisions (memory_id, workspace_id, rationale, decision_maker, effective_at)
VALUES (
  '66666666-6666-4666-8666-666666666601',
  '11111111-1111-4111-8111-111111111111',
  'Audit PR must land before remediation slices.',
  'chatgpt',
  '2026-08-09T00:00:00Z'
);

INSERT INTO project_state_versions (
  id, workspace_id, project_id, version, state, summary, created_by_subject
) VALUES (
  '77777777-7777-4777-8777-777777777701',
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444401',
  1,
  '{
    "stage": "slice-01-ready",
    "completed": ["product-design-audit"],
    "in_progress": [],
    "blocked": [],
    "next": ["implement slice 01"],
    "risks": [],
    "active_decisions": ["66666666-6666-4666-8666-666666666601"]
  }'::jsonb,
  'Slice 01 ready after audit PR #215',
  '33333333-3333-4333-8333-333333333302'
);

-- Demo API clients (identity stubs)
INSERT INTO api_clients (workspace_id, subject_id, client_id, audience)
VALUES
  ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333301', 'demo-owner', ARRAY['memory-api', 'mcp']),
  ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333302', 'demo-chatgpt', ARRAY['memory-api', 'mcp']),
  ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333303', 'demo-cursor', ARRAY['memory-api', 'mcp']),
  ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333304', 'demo-roma', ARRAY['memory-api', 'mcp'])
ON CONFLICT (workspace_id, client_id) DO NOTHING;
