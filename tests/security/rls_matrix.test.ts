import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('RLS matrix artifacts', () => {
  it('ships helper migration with deny-first ACL', () => {
    const sql = readFileSync(
      resolve(root, 'supabase/migrations/20260811120500_rls_helpers_and_policies.sql'),
      'utf8',
    );
    expect(sql).toContain('CREATE OR REPLACE FUNCTION app.has_acl');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('source_events_no_update');
    expect(sql).toContain('audit_no_update');
  });

  it('documents required negative cases', () => {
    const doc = readFileSync(
      resolve(root, 'docs/engineering/RLS_MATRIX.md'),
      'utf8',
    );
    expect(doc).toMatch(/Wrong workspace/);
    expect(doc).toMatch(/personal/);
    expect(doc).toMatch(/idempotency/);
    expect(doc).toMatch(/unauthenticated MCP HTTP/i);
    expect(doc).toMatch(/exactly 7 tools/i);
    expect(doc).toMatch(/AISTROYKA/i);
  });

  it('includes SQL policy cases fixture', () => {
    const sql = readFileSync(
      resolve(root, 'tests/security/rls_policy_cases.sql'),
      'utf8',
    );
    expect(sql).toContain('app.subject_id');
    expect(sql).toContain('stranger_count');
  });
});
