import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const p0MigrationPath = resolve(
  root,
  'supabase/migrations/20260824100000_p0_project_identity_scope.sql',
);
const policyCasesPath = resolve(
  root,
  'tests/security/p0_routing_corrections_policy_cases.sql',
);

describe('P0 project_routing_corrections RLS pack', () => {
  const p0Sql = readFileSync(p0MigrationPath, 'utf8');
  const policySql = readFileSync(policyCasesPath, 'utf8');

  it('enables forced RLS and revokes direct table grants from client roles', () => {
    expect(p0Sql).toContain(
      'ALTER TABLE project_routing_corrections ENABLE ROW LEVEL SECURITY',
    );
    expect(p0Sql).toContain(
      'ALTER TABLE project_routing_corrections FORCE ROW LEVEL SECURITY',
    );
    expect(p0Sql).toContain(
      'REVOKE ALL ON TABLE project_routing_corrections FROM PUBLIC, anon, authenticated',
    );
    expect(p0Sql).not.toMatch(
      /CREATE POLICY[\s\S]*project_routing_corrections[\s\S]*USING \(true\)/,
    );
  });

  it('keeps correction apply on owner-checked SECURITY DEFINER RPC with fixed search_path', () => {
    expect(p0Sql).toContain('CREATE OR REPLACE FUNCTION app.api_apply_project_routing_correction');
    expect(p0Sql).toContain(`SET search_path = public, app`);
    expect(p0Sql).toContain(`wm.role = 'owner'`);
    expect(p0Sql).toContain(
      'REVOKE ALL ON FUNCTION app.api_apply_project_routing_correction',
    );
    expect(p0Sql).toContain(
      'GRANT EXECUTE ON FUNCTION app.api_apply_project_routing_correction',
    );
  });

  it('ships ephemeral SQL negative and privileged RPC cases', () => {
    expect(policySql).toContain('permission denied for anon');
    expect(policySql).toContain('permission denied for authenticated');
    expect(policySql).toContain('chatgpt cannot apply routing correction');
    expect(policySql).toContain('cursor cannot apply routing correction');
    expect(policySql).toContain('owner routing correction apply succeeds');
    expect(policySql).toContain('rls_enabled_on_project_routing_corrections');
  });
});
