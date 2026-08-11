-- RLS negative/positive cases for synthetic seed.
-- Run after migrations + seed, as a role that respects RLS (not bypassrls).
-- Set GUCs before each block.

-- === Owner can read decision ===
SELECT set_config('app.subject_id', '33333333-3333-4333-8333-333333333301', true);
SELECT set_config('app.workspace_id', '11111111-1111-4111-8111-111111111111', true);
SELECT count(*) AS owner_memory_count FROM memory_records;
-- expect: >= 1

-- === ChatGPT can read project decision ===
SELECT set_config('app.subject_id', '33333333-3333-4333-8333-333333333302', true);
SELECT count(*) AS chatgpt_memory_count FROM memory_records
WHERE project_id = '44444444-4444-4444-8444-444444444401';
-- expect: >= 1

-- === Cursor can read project memory (internal) ===
SELECT set_config('app.subject_id', '33333333-3333-4333-8333-333333333303', true);
SELECT count(*) AS cursor_memory_count FROM memory_records
WHERE project_id = '44444444-4444-4444-8444-444444444401';
-- expect: >= 1

-- === Wrong workspace subject sees nothing ===
SELECT set_config('app.subject_id', '99999999-9999-4999-8999-999999999999', true);
SELECT count(*) AS stranger_count FROM memory_records;
-- expect: 0

-- === Append-only: update source_events must fail / affect 0 under RLS ===
SELECT set_config('app.subject_id', '33333333-3333-4333-8333-333333333301', true);
UPDATE source_events SET event_type = 'tampered' WHERE id = '55555555-5555-4555-8555-555555555501';
-- expect: 0 rows

-- === Idempotency unique ===
-- INSERT duplicate idempotency_key should raise unique_violation
